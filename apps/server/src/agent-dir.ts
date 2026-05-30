import { homedir } from "node:os";
import { join } from "node:path";

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
	return expandHomePath(process.env.APREAL_HOME?.trim() || join(homedir(), ".apreal"));
}

export function getAprealAgentDir(): string {
	return expandHomePath(process.env.APREAL_AGENT_DIR?.trim() || join(getAprealHomeDir(), "agent"));
}

export function getAprealAgentPath(...segments: string[]): string {
	return join(getAprealAgentDir(), ...segments);
}

export function getAprealServerDatabasePath(): string {
	return getAprealAgentPath("sessions.db");
}
