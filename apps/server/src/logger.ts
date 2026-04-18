const LOG_LEVEL_ORDER = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
} as const;

export type LogLevel = keyof typeof LOG_LEVEL_ORDER;

type LogFields = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_LEVEL: LogLevel = "info";

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
	const configuredLevel = parseLogLevel(process.env.LOG_LEVEL);
	return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[configuredLevel];
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

	const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${serializeFields(fields)}`;
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