import { homedir } from "node:os";
import { join } from "node:path";

import { getServerEnv } from "./env.ts";

function expandHomePath(path: string): string {
	if (path === "~") {
		return homedir();
	}

	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}

	return path;
}

export function getAprealHomeDir(): string {
	const env = getServerEnv();
	return expandHomePath(env.APREAL_HOME || join(homedir(), ".apreal"));
}

export function getAprealAgentDir(): string {
	const env = getServerEnv();
	return expandHomePath(env.APREAL_AGENT_DIR || join(getAprealHomeDir(), "agent"));
}

export function getAprealAgentPath(...segments: string[]): string {
	return join(getAprealAgentDir(), ...segments);
}

export function getAprealServerDatabasePath(): string {
	return getAprealAgentPath("sessions.db");
}
