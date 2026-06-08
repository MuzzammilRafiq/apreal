import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { IncomingMessage } from "node:http";

import { getRelayEnv, readOptionalRelayEnv, readRequiredRelayEnv } from "./env.ts";

const require = createRequire(import.meta.url);

function resolveAuthBaseUrl(): string {
	const env = getRelayEnv();
	const configuredUrl = readOptionalRelayEnv("BETTER_AUTH_URL", "APREAL_AUTH_URL");
	if (configuredUrl) {
		return configuredUrl.replace(/\/$/, "");
	}

	return `http://localhost:${env.PORT}`;
}

function resolveAuthDatabasePath(): string {
	const env = getRelayEnv();
	const configuredPath = env.BETTER_AUTH_SQLITE_PATH;
	if (configuredPath) {
		return resolve(configuredPath);
	}

	const tokenStorePath = env.RELAY_TOKEN_STORE_PATH;
	if (tokenStorePath) {
		return resolve(dirname(resolve(tokenStorePath)), "better-auth.sqlite");
	}

	return resolve(process.cwd(), ".data", "better-auth.sqlite");
}

function createAuthDatabase() {
	const databasePath = resolveAuthDatabasePath();
	mkdirSync(dirname(databasePath), { recursive: true });

	const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
	const database = new DatabaseSync(databasePath);
	if (!existsSync(databasePath)) {
		throw new Error("Better Auth SQLite database could not be created.");
	}

	return database;
}

function createAuthOptions() {
	const authBaseUrl = resolveAuthBaseUrl();
	const env = getRelayEnv();
	const trustedOrigins = [
		authBaseUrl,
		...(env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
			.split(",")
			.map((origin) => origin.trim().replace(/\/$/, ""))
			.filter(Boolean),
	];
	const crossSiteCookieAttributes = {
		sameSite: "none" as const,
		secure: true,
	};

	return {
		appName: "Apreal",
		baseURL: authBaseUrl,
		secret: readRequiredRelayEnv("BETTER_AUTH_SECRET", "JWT_SECRET"),
		database: createAuthDatabase(),
		socialProviders: {
			google: {
				clientId: readRequiredRelayEnv("BETTER_AUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
				clientSecret: readRequiredRelayEnv("BETTER_AUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
				accessType: "offline",
				prompt: "select_account consent",
				redirectURI: `${authBaseUrl}/api/auth/callback/google`,
			},
		},
		trustedOrigins,
		advanced: {
			cookies: {
				state: {
					attributes: crossSiteCookieAttributes,
				},
				session_token: {
					attributes: crossSiteCookieAttributes,
				},
				session_data: {
					attributes: crossSiteCookieAttributes,
				},
				account_data: {
					attributes: crossSiteCookieAttributes,
				},
				dont_remember_token: {
					attributes: crossSiteCookieAttributes,
				},
			},
		},
	} as const;
}

function createAuth() {
	return betterAuth(createAuthOptions());
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];

let cachedAuth: Auth | null = null;
let cachedAuthHandler: ReturnType<typeof toNodeHandler> | null = null;
let authReadyPromise: Promise<void> | null = null;

export function isBetterAuthConfigured(): boolean {
	return Boolean(
		readOptionalRelayEnv("BETTER_AUTH_SECRET", "JWT_SECRET") &&
		readOptionalRelayEnv("BETTER_AUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID") &&
		readOptionalRelayEnv("BETTER_AUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
	);
}

export function getBetterAuth(): Auth {
	cachedAuth ??= createAuth();
	return cachedAuth;
}

export function getBetterAuthHandler(): ReturnType<typeof toNodeHandler> {
	cachedAuthHandler ??= toNodeHandler(getBetterAuth());
	return cachedAuthHandler;
}

export async function ensureBetterAuthReady(): Promise<void> {
	if (!isBetterAuthConfigured()) {
		return;
	}

	authReadyPromise ??= (async () => {
		const betterAuthMainPath = require.resolve("better-auth");
		const migrationModulePath = pathToFileURL(resolve(dirname(betterAuthMainPath), "db", "get-migration.mjs")).href;
		const { getMigrations } = await import(migrationModulePath);
		const { runMigrations } = await getMigrations(createAuthOptions());
		await runMigrations();
	})();

	await authReadyPromise;
}

export async function readBetterAuthUserId(request: IncomingMessage): Promise<string | null> {
	if (!isBetterAuthConfigured()) {
		return null;
	}

	await ensureBetterAuthReady();
	const session = await getBetterAuth().api.getSession({
		headers: fromNodeHeaders(request.headers),
		query: {
			disableRefresh: true,
		},
	});

	return session?.user.id ?? null;
}
