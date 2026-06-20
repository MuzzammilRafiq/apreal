import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { betterAuth, type Session } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { IncomingMessage } from "node:http";

import { getRelayEnv, readOptionalRelayEnv, readRequiredRelayEnv } from "./env.ts";
import { audit } from "./utils/audit.ts";

const require = createRequire(import.meta.url);

// Chooses the public base URL Better Auth should embed into redirects and
// cookies, falling back to the relay's local host/port during development.
function resolveAuthBaseUrl(): string {
	const env = getRelayEnv();
	const configuredUrl = readOptionalRelayEnv("BETTER_AUTH_URL", "APREAL_AUTH_URL");
	if (configuredUrl) {
		return configuredUrl.replace(/\/$/, "");
	}

	return `http://localhost:${env.PORT}`;
}

// Chooses where the Better Auth SQLite file lives, preferring explicit config
// and otherwise colocating it with the relay's other persisted state.
function resolveAuthDatabasePath(): string {
	const env = getRelayEnv();
	const configuredPath = env.BETTER_AUTH_SQLITE_PATH;
	if (configuredPath) {
		return resolve(configuredPath);
	}

	const ownerBindingStorePath = env.RELAY_OWNER_BINDING_STORE_PATH ?? env.RELAY_TOKEN_STORE_PATH;
	if (ownerBindingStorePath) {
		return resolve(dirname(resolve(ownerBindingStorePath)), "better-auth.sqlite");
	}

	return resolve(process.cwd(), ".data", "better-auth.sqlite");
}

// Creates the SQLite database handle Better Auth uses for sessions, accounts,
// and OAuth bookkeeping.
function createAuthDatabase() {
	const databasePath = resolveAuthDatabasePath();
	const databaseDirectory = dirname(databasePath);
	mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 });
	chmodSync(databaseDirectory, 0o700);

	const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
	const database = new DatabaseSync(databasePath);
	if (!existsSync(databasePath)) {
		throw new Error("Better Auth SQLite database could not be created.");
	}
	chmodSync(databasePath, 0o600);

	return database;
}

// Builds the full Better Auth configuration, including Google OAuth, trusted
// origins, and cookie attributes needed for cross-site auth flows.
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
		secret: readRequiredRelayEnv("BETTER_AUTH_SECRET"),
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
		databaseHooks: {
			session: {
				create: {
					async after(session: Session) {
						audit("auth.sign_in", "success", {
							actorType: "user",
							actorId: session.userId,
						});
					},
				},
				delete: {
					async after(session: Session) {
						audit("auth.sign_out", "success", {
							actorType: "user",
							actorId: session.userId,
						});
					},
				},
			},
		},
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

// Instantiates the Better Auth runtime from the relay's configuration.
function createAuth() {
	return betterAuth(createAuthOptions());
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];

let cachedAuth: Auth | null = null;
let cachedAuthHandler: ReturnType<typeof toNodeHandler> | null = null;
let authReadyPromise: Promise<void> | null = null;

// Reports whether enough env is present to enable Better Auth at all.
export function isBetterAuthConfigured(): boolean {
	return Boolean(
		readOptionalRelayEnv("BETTER_AUTH_SECRET") &&
		readOptionalRelayEnv("BETTER_AUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID") &&
		readOptionalRelayEnv("BETTER_AUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
	);
}

// Lazily creates and caches the Better Auth instance for request handlers.
export function getBetterAuth(): Auth {
	cachedAuth ??= createAuth();
	return cachedAuth;
}

// Adapts Better Auth's API surface into a Node HTTP request handler and caches
// that adapter for reuse.
export function getBetterAuthHandler(): ReturnType<typeof toNodeHandler> {
	cachedAuthHandler ??= toNodeHandler(getBetterAuth());
	return cachedAuthHandler;
}

// Runs Better Auth migrations once before the first real auth request so the
// SQLite schema exists on fresh deployments.
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

// Reads the currently signed-in Better Auth user id from the request cookies
// without forcing a session refresh.
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
