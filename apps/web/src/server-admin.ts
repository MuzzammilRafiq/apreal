import {
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	type LocalWebAdminStatus,
	type RelayReauthenticateRequest,
	type RelayReauthenticateResponse,
} from "@apreal/shared";
import type { ScheduledJobDetails } from "./chatTypes";

const ADMIN_JOBS_PATH = "/api/admin/jobs";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getResponseMessage(payload: unknown, fallback: string): string {
	if (isObjectRecord(payload) && typeof payload.message === "string") {
		return payload.message;
	}

	return fallback;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function parseStatus(payload: unknown): LocalWebAdminStatus {
	if (!isObjectRecord(payload)) {
		throw new Error("Server status returned an invalid response.");
	}

	if (
		payload.service !== "web-server" ||
		typeof payload.port !== "number" ||
		typeof payload.cwd !== "string" ||
		typeof payload.relayUrl !== "string" ||
		typeof payload.relayReady !== "boolean" ||
		typeof payload.relayTransportConnected !== "boolean" ||
		typeof payload.reauthPending !== "boolean" ||
		typeof payload.reauthRunning !== "boolean" ||
		typeof payload.webUiReady !== "boolean" ||
		typeof payload.webUiPath !== "string"
	) {
		throw new Error("Server status returned an invalid response.");
	}

	return payload as LocalWebAdminStatus;
}

function parseScheduledJobs(payload: unknown): ScheduledJobDetails[] {
	if (!isObjectRecord(payload) || !Array.isArray(payload.jobs)) {
		throw new Error("Scheduled jobs returned an invalid response.");
	}

	return payload.jobs.map((job) => {
		if (
			!isObjectRecord(job) ||
			typeof job.id !== "string" ||
			typeof job.name !== "string" ||
			typeof job.prompt !== "string" ||
			typeof job.intervalMs !== "number" ||
			typeof job.enabled !== "boolean" ||
			typeof job.nextRunAt !== "number" ||
			typeof job.createdAt !== "number" ||
			typeof job.updatedAt !== "number" ||
			typeof job.runCount !== "number" ||
			typeof job.maxCatchup !== "number" ||
			(job.lastRunAt !== null && typeof job.lastRunAt !== "number") ||
			(job.lastError !== null && typeof job.lastError !== "string")
		) {
			throw new Error("Scheduled jobs returned an invalid response.");
		}

		return job as ScheduledJobDetails;
	});
}

export async function readLocalAdminStatus(statusUrl: string): Promise<LocalWebAdminStatus> {
	const response = await fetch(statusUrl, {
		method: "GET",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Server status failed with status ${response.status}`));
	}

	return parseStatus(payload);
}

export async function submitRelayReauthentication(
	requestUrl: string,
	pairingCode: string,
): Promise<RelayReauthenticateResponse> {
	const requestBody: RelayReauthenticateRequest = { pairingCode };
	const response = await fetch(requestUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(requestBody),
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Relay reauthentication failed with status ${response.status}`));
	}

	if (!isObjectRecord(payload) || !("status" in payload)) {
		throw new Error("Relay reauthentication returned an invalid response.");
	}

	return {
		status: parseStatus(payload.status),
	};
}

export async function readScheduledJobs(requestUrl = ADMIN_JOBS_PATH): Promise<ScheduledJobDetails[]> {
	const response = await fetch(requestUrl, {
		method: "GET",
		headers: {
			accept: "application/json",
		},
	});
	const payload = await parseJsonResponse(response);
	if (!response.ok) {
		throw new Error(getResponseMessage(payload, `Scheduled jobs request failed with status ${response.status}`));
	}

	return parseScheduledJobs(payload);
}

export {
	ADMIN_JOBS_PATH,
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
};