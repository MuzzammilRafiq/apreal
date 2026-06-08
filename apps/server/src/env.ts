import { createEnv } from "@t3-oss/env-core";
import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env.local" });
config();

const optionalNonEmptyString = z.string().trim().min(1).optional();
const optionalPort = z.coerce.number().int().min(1).max(65535).optional();
const optionalUrl = z.string().trim().url().optional();

export function getServerEnv() {
	return createEnv({
		server: {
			APREAL_AGENT_DIR: optionalNonEmptyString,
			APREAL_ALLOW_PRIVATE_NETWORK_ADMIN: z.enum(["true", "false"]).optional(),
			APREAL_CORS_ALLOW_ORIGIN: optionalNonEmptyString,
			APREAL_CORS_ALLOW_ORIGINS: optionalNonEmptyString,
			APREAL_HOME: optionalNonEmptyString,
			LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
			NO_COLOR: optionalNonEmptyString,
			PI_RELAY_URL: optionalUrl,
			PI_WORKSPACE_ROOT: optionalNonEmptyString,
			PORT: optionalPort,
		},
		runtimeEnv: process.env,
		emptyStringAsUndefined: true,
	});
}

export type ServerEnv = ReturnType<typeof getServerEnv>;
