import type { IncomingMessage } from "node:http";
import {
	type RelayAgentAuthRequest,
	type RelayAgentMessage,
	type RelayClientAuthRequest,
	type RelayConnectionRequest,
} from "@apreal/shared";
import { readRequestBody } from "./http.ts";

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStringField(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function readUrlField(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}

		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

export async function parseRelayConnectionRequest(request: IncomingMessage): Promise<RelayConnectionRequest | null> {
	let value: unknown;
	try {
		const rawBody = await readRequestBody(request);
		value = JSON.parse(rawBody);
	} catch {
		return null;
	}

	if (!isObjectRecord(value) || typeof value.targetId !== "string") {
		return null;
	}

	if (value.targetType !== undefined && value.targetType !== "agent" && value.targetType !== "client") {
		return null;
	}

	return {
		targetId: value.targetId.trim(),
		targetType: value.targetType,
	};
}

export async function parseClientAuthRequest(request: IncomingMessage): Promise<RelayClientAuthRequest | null> {
	let value: unknown;
	try {
		const rawBody = await readRequestBody(request);
		value = JSON.parse(rawBody);
	} catch {
		return null;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	const clientId = readStringField(value.clientId);
	const clientKey = readStringField(value.clientKey);
	if (!clientId || !clientKey) {
		return null;
	}

	const ownerGrant =
		value.ownerGrant === undefined || value.ownerGrant === null ? null : readStringField(value.ownerGrant);

	return { clientId, clientKey, ownerGrant };
}

export async function parseAgentAuthRequest(request: IncomingMessage): Promise<RelayAgentAuthRequest | null> {
	let value: unknown;
	try {
		const rawBody = await readRequestBody(request);
		value = JSON.parse(rawBody);
	} catch {
		return null;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	const agentId = readStringField(value.agentId);
	const agentKey = readStringField(value.agentKey);
	const serverUrl = readUrlField(value.serverUrl);
	if (!agentId || !agentKey) {
		return null;
	}

	const ownerGrant =
		value.ownerGrant === undefined || value.ownerGrant === null ? null : readStringField(value.ownerGrant);

	return {
		agentId,
		agentKey,
		...(serverUrl ? { serverUrl } : {}),
		ownerGrant,
	};
}

export function parseRelayAgentMessage(value: unknown): RelayAgentMessage | null {
	if (!isObjectRecord(value) || value.type !== "server_message") {
		return null;
	}

	const clientId = readStringField(value.clientId);
	if (!clientId) {
		return null;
	}

	return {
		type: "server_message",
		clientId,
		message: value.message,
	};
}
