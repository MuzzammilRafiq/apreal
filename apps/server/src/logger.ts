import { getServerEnv } from "./env.ts";

const LOG_LEVEL_ORDER = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
} as const;

export type LogLevel = keyof typeof LOG_LEVEL_ORDER;

type LogFields = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_LEVEL: LogLevel = "info";
const ANSI_RESET = "\x1b[0m";
const TIMESTAMP_COLOR = "\x1b[90m";
const DATA_COLOR = "\x1b[96m";
const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: "\x1b[94m",
	info: "\x1b[92m",
	warn: "\x1b[93m",
	error: "\x1b[91m",
};
const SCOPE_COLORS = ["\x1b[95m", "\x1b[96m", "\x1b[94m", "\x1b[92m", "\x1b[93m", "\x1b[36m"] as const;

function parseLogLevel(value: string | undefined): LogLevel {
	if (!value) {
		return DEFAULT_LEVEL;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized in LOG_LEVEL_ORDER) {
		return normalized as LogLevel;
	}

	return DEFAULT_LEVEL;
}

function shouldLog(level: LogLevel): boolean {
	const configuredLevel = parseLogLevel(getServerEnv().LOG_LEVEL);
	return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[configuredLevel];
}

function supportsColor(): boolean {
	if (getServerEnv().NO_COLOR) {
		return false;
	}

	return Boolean(process.stdout.isTTY);
}

function colorize(value: string, color: string): string {
	if (!supportsColor()) {
		return value;
	}

	return `${color}${value}${ANSI_RESET}`;
}

function pickScopeColor(scope: string): string {
	let hash = 0;
	for (let index = 0; index < scope.length; index += 1) {
		hash = (hash * 31 + scope.charCodeAt(index)) >>> 0;
	}

	return SCOPE_COLORS[hash % SCOPE_COLORS.length] ?? "\x1b[95m";
}

function serializeFields(fields: LogFields | undefined): string {
	if (!fields) {
		return "";
	}

	const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
	if (entries.length === 0) {
		return "";
	}

	return ` ${JSON.stringify(Object.fromEntries(entries))}`;
}

function emit(level: LogLevel, scope: string, message: string, fields?: LogFields) {
	if (!shouldLog(level)) {
		return;
	}

	const timestamp = colorize(new Date().toISOString(), TIMESTAMP_COLOR);
	const levelLabel = colorize(level.toUpperCase(), LEVEL_COLORS[level]);
	const scopeLabel = colorize(`[${scope}]`, pickScopeColor(scope));
	const data = colorize(`${message}${serializeFields(fields)}`, DATA_COLOR);
	const line = `${timestamp} ${levelLabel} ${scopeLabel} ${data}`;
	if (level === "error") {
		console.error(line);
		return;
	}

	if (level === "warn") {
		console.warn(line);
		return;
	}

	console.log(line);
}

export function createLogger(scope: string) {
	return {
		debug(message: string, fields?: LogFields) {
			emit("debug", scope, message, fields);
		},
		info(message: string, fields?: LogFields) {
			emit("info", scope, message, fields);
		},
		warn(message: string, fields?: LogFields) {
			emit("warn", scope, message, fields);
		},
		error(message: string, fields?: LogFields) {
			emit("error", scope, message, fields);
		},
	};
}

export function summarizePrompt(input: string, maxLength = 120): string {
	const normalized = input.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}
