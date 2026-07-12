import { join } from "node:path";
import { loadAprealRuntime } from "./config.ts";
import { APREAL_STATE_FILENAMES } from "./constants.ts";

export function getAprealHomeDir(): string {
	return loadAprealRuntime().home;
}

export function getAprealAgentDir(): string {
	return loadAprealRuntime().paths.agent;
}

export function getAprealAgentPath(...segments: string[]): string {
	return join(getAprealAgentDir(), ...segments);
}

export function getAprealServerDatabasePath(): string {
	return getAprealAgentPath(APREAL_STATE_FILENAMES.sessionsDatabase);
}
