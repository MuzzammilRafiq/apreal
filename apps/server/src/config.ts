import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
import {
	APREAL_HOME_DIRECTORY_NAME,
	APREAL_STATE_DIRECTORY_NAMES,
	CONFIG_FILENAME,
	DEFAULT_LOG_LEVEL,
	DEFAULT_OPEN_BROWSER,
	DEFAULT_SERVER_HOST,
	DEFAULT_SERVER_PORT,
} from "./constants.ts";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const relativePathSchema = z.string().trim().min(1).refine((value) => !isAbsolute(value), {
	message: "must be a relative path beneath the selected Apreal home",
}).refine((value) => !value.split(/[\\/]+/).includes(".."), {
	message: "must not traverse outside the selected Apreal home",
});
const configSchema = z.object({
	server: z.object({
		host: z.string().trim().min(1).default(DEFAULT_SERVER_HOST),
		port: z.number().int().min(1).max(65_535).default(DEFAULT_SERVER_PORT),
		log_level: logLevelSchema.default(DEFAULT_LOG_LEVEL),
		allow_private_network_admin: z.boolean().default(false),
		open_browser: z.boolean().default(DEFAULT_OPEN_BROWSER),
	}).default({
		host: DEFAULT_SERVER_HOST,
		port: DEFAULT_SERVER_PORT,
		log_level: DEFAULT_LOG_LEVEL,
		allow_private_network_admin: false,
		open_browser: DEFAULT_OPEN_BROWSER,
	}),
	paths: z.object({
		agent_dir: relativePathSchema.default(APREAL_STATE_DIRECTORY_NAMES.agent),
		logs_dir: relativePathSchema.default(APREAL_STATE_DIRECTORY_NAMES.logs),
	}).default({
		agent_dir: APREAL_STATE_DIRECTORY_NAMES.agent,
		logs_dir: APREAL_STATE_DIRECTORY_NAMES.logs,
	}),
	development: z.object({
		cors_allow_origins: z.array(z.string().url()).default([]),
	}).default({ cors_allow_origins: [] }),
});

export type AprealConfig = Readonly<z.infer<typeof configSchema>>;
export type AprealRuntime = Readonly<{
	home: string;
	configPath: string;
	config: AprealConfig;
	paths: Readonly<{ agent: string; logs: string; run: string }>;
}>;

let cachedRuntime: AprealRuntime | undefined;

function expandHomePath(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return join(homedir(), value.slice(2));
	return resolve(value);
}

function readHomeArgument(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--home") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) throw new Error("--home requires a path");
			return value;
		}
		if (argument?.startsWith("--home=")) {
			const value = argument.slice("--home=".length);
			if (!value) throw new Error("--home requires a path");
			return value;
		}
	}
	return undefined;
}

function formatConfigError(configPath: string, error: z.ZodError): Error {
	const details = error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; ");
	return new Error(`Invalid Apreal configuration at ${configPath}: ${details}`);
}

function warnAboutUnknownKeys(document: unknown, configPath: string): void {
	if (!document || typeof document !== "object" || Array.isArray(document)) return;
	const sections: Record<string, readonly string[]> = {
		server: ["host", "port", "log_level", "allow_private_network_admin", "open_browser"],
		paths: ["agent_dir", "logs_dir"],
		development: ["cors_allow_origins"],
	};
	for (const [section, value] of Object.entries(document)) {
		const knownKeys = sections[section];
		if (!knownKeys) {
			console.warn(`Unknown Apreal configuration key in ${configPath}: ${section}`);
			continue;
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		for (const key of Object.keys(value)) {
			if (!knownKeys.includes(key)) console.warn(`Unknown Apreal configuration key in ${configPath}: ${section}.${key}`);
		}
	}
}

export function loadAprealRuntime(argv: readonly string[] = process.argv.slice(2)): AprealRuntime {
	if (cachedRuntime) return cachedRuntime;
	const home = expandHomePath(readHomeArgument(argv) ?? join(homedir(), APREAL_HOME_DIRECTORY_NAME));
	const configPath = join(home, CONFIG_FILENAME);
	let document: unknown = {};
	if (existsSync(configPath)) {
		try {
			document = parse(readFileSync(configPath, "utf8"));
		} catch (error) {
			throw new Error(`Unable to parse Apreal configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	warnAboutUnknownKeys(document, configPath);
	const result = configSchema.safeParse(document);
	if (!result.success) throw formatConfigError(configPath, result.error);
	const config = Object.freeze({
		...result.data,
		server: Object.freeze(result.data.server),
		paths: Object.freeze(result.data.paths),
		development: Object.freeze({ ...result.data.development, cors_allow_origins: Object.freeze([...result.data.development.cors_allow_origins]) }),
	}) as AprealConfig;
	cachedRuntime = Object.freeze({
		home,
		configPath,
		config,
		paths: Object.freeze({
			agent: resolve(home, config.paths.agent_dir),
			logs: resolve(home, config.paths.logs_dir),
			run: resolve(home, APREAL_STATE_DIRECTORY_NAMES.run),
		}),
	});
	return cachedRuntime;
}

export function resetAprealRuntimeForTests(): void {
	cachedRuntime = undefined;
}
