import {
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	type LocalWebAdminStatus,
	type RelayReauthenticateRequest,
	type RelayReauthenticateResponse,
} from "@apreal/shared";

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

export {
	ADMIN_RELAY_REAUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
};