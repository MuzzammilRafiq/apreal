import { createEnv } from "@t3-oss/env-core";
import { config } from "dotenv";
import { z } from "zod";

import { DEFAULT_PORT } from "./relay/constants.ts";

config({ path: ".env.local" });
config();

const optionalNonEmptyString = z.string().trim().min(1).optional();
const optionalPort = z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT);
const optionalUrl = z.url().optional();

// Parses relay-specific environment variables and normalizes empty strings so
// the rest of the code can treat missing config consistently.
export function getRelayEnv() {
	return createEnv({
		server: {
			APREAL_AUTH_URL: optionalUrl,
			BETTER_AUTH_GOOGLE_CLIENT_ID: optionalNonEmptyString,
			BETTER_AUTH_GOOGLE_CLIENT_SECRET: optionalNonEmptyString,
			BETTER_AUTH_SECRET: optionalNonEmptyString,
			BETTER_AUTH_SQLITE_PATH: optionalNonEmptyString,
			BETTER_AUTH_TRUSTED_ORIGINS: optionalNonEmptyString,
			BETTER_AUTH_URL: optionalUrl,
			GOOGLE_CLIENT_ID: optionalNonEmptyString,
			GOOGLE_CLIENT_SECRET: optionalNonEmptyString,
			JWT_SECRET: optionalNonEmptyString,
			NO_COLOR: optionalNonEmptyString,
			PORT: optionalPort,
			RELAY_CORS_ALLOW_ORIGIN: optionalNonEmptyString,
			RELAY_CORS_ALLOW_ORIGINS: optionalNonEmptyString,
			RELAY_OWNER_BINDING_STORE_PATH: optionalNonEmptyString,
			RELAY_SQLITE_PATH: optionalNonEmptyString,
			RELAY_TOKEN_STORE_PATH: optionalNonEmptyString,
		},
		runtimeEnv: process.env,
		emptyStringAsUndefined: true,
	});
}

type RelayEnv = ReturnType<typeof getRelayEnv>;
type RelayEnvStringKey = Extract<{
	[K in keyof RelayEnv]: RelayEnv[K] extends string | undefined ? K : never;
}[keyof RelayEnv], string>;

// Returns the first configured non-empty value from a list of compatible env
// names such as BETTER_AUTH_* and legacy fallbacks.
export function readOptionalRelayEnv(...names: RelayEnvStringKey[]): string | null {
	const env = getRelayEnv();
	for (const name of names) {
		const value = env[name];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}

	return null;
}

// Same as readOptionalRelayEnv, but fails fast when none of the accepted env
// names are configured.
export function readRequiredRelayEnv(...names: RelayEnvStringKey[]): string {
	const value = readOptionalRelayEnv(...names);
	if (value) {
		return value;
	}

	throw new Error(`Missing required auth environment variable: ${names.join(" or ")}`);
}

// Small helper for health/status responses that need to report whether JWT
// signing is available.
export function hasRelayJwtSecret(): boolean {
	return Boolean(getRelayEnv().JWT_SECRET);
}

export type { RelayEnv, RelayEnvStringKey };
