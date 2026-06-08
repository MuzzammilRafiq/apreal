import { getRelayEnv } from "../env.ts";

export type LogLevel = "info" | "warn" | "error";

const ANSI_RESET = "\x1b[0m";
const TIMESTAMP_COLOR = "\x1b[90m";
const DATA_COLOR = "\x1b[96m";
const LEVEL_COLORS: Record<LogLevel, string> = {
	info: "\x1b[92m",
	warn: "\x1b[93m",
	error: "\x1b[91m",
};
const TAG_COLORS = ["\x1b[95m", "\x1b[96m", "\x1b[94m", "\x1b[92m", "\x1b[93m", "\x1b[36m"] as const;


const supportsColor = (): boolean => {
	if (getRelayEnv().NO_COLOR) {
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

function pickTagColor(tag: string): string {
	let hash = 0;
	for (let index = 0; index < tag.length; index += 1) {
		hash = (hash * 31 + tag.charCodeAt(index)) >>> 0;
	}

	return TAG_COLORS[hash % TAG_COLORS.length] ?? "\x1b[95m";
}

export function log(level: LogLevel, message: string, fields?: Record<string, unknown>) {
	const tag = "relay-server";
	const serializedFields = fields ? ` ${JSON.stringify(fields)}` : "";
	const timestamp = colorize(new Date().toISOString(), TIMESTAMP_COLOR);
	const levelLabel = colorize(level.toUpperCase(), LEVEL_COLORS[level]);
	const tagLabel = colorize(`[${tag}]`, pickTagColor(tag));
	const dataLabel = colorize(`${message}${serializedFields}`, DATA_COLOR);
	const line = `${timestamp} ${levelLabel} ${tagLabel} ${dataLabel}`;

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
