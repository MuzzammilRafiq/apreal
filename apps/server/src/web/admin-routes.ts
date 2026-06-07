import { buildSessionSummary, type SharedSessionState } from "./session-state.ts";

const ADMIN_JOBS_PATH = "/api/admin/jobs";
const ADMIN_JOBS_PATH_PREFIX = `${ADMIN_JOBS_PATH}/`;
const ADMIN_MCP_PATH = "/api/admin/mcp";
const ADMIN_MCP_PATH_PREFIX = `${ADMIN_MCP_PATH}/`;

export function parseAdminJobRoute(pathname: string): { jobId: string; subpath: "runs" | null } | null {
	if (!pathname.startsWith(ADMIN_JOBS_PATH_PREFIX)) {
		return null;
	}

	const remainder = pathname.slice(ADMIN_JOBS_PATH_PREFIX.length);
	const [jobIdPart, subpath, ...rest] = remainder.split("/").filter(Boolean);
	if (!jobIdPart || rest.length > 0) {
		return null;
	}

	if (subpath && subpath !== "runs") {
		return null;
	}

	try {
		return {
			jobId: decodeURIComponent(jobIdPart),
			subpath: subpath === "runs" ? "runs" : null,
		};
	} catch {
		return null;
	}
}

export function parseAdminMcpRoute(pathname: string): { serverId: string } | null {
	if (!pathname.startsWith(ADMIN_MCP_PATH_PREFIX)) {
		return null;
	}

	const remainder = pathname.slice(ADMIN_MCP_PATH_PREFIX.length);
	const parts = remainder.split("/").filter(Boolean);
	if (parts.length !== 1 || !parts[0]) {
		return null;
	}

	try {
		return { serverId: decodeURIComponent(parts[0]) };
	} catch {
		return null;
	}
}

export function listScheduledJobRuns(jobName: string, sessions: Map<string, SharedSessionState>) {
	const prefix = `[Scheduled: ${jobName}]`;
	return [...sessions.values()]
		.filter((session) => session.title.startsWith(prefix))
		.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
		.map((session) => buildSessionSummary(session));
}
