import type { IncomingMessage } from "node:http";
import {
	type RelayAgentAuthRequest,
	type RelayAgentMessage,
	type RelayClientAuthRequest,
	type RelayConnectionRequest,
} from "@apreal/shared";
import { readRequestBody } from "./http.ts";

// Shared guard for JSON-decoded request bodies.
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Reads a trimmed non-empty string field from parsed JSON.
export function readStringField(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

// Reads and normalizes an HTTP(S) URL field from parsed JSON.
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

// Parses the generic relay connection authorization request used to confirm a
// token is scoped to a specific target.
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

// Parses the browser client's auth or heartbeat payload.
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

	const ownerGrant =
		value.ownerGrant === undefined || value.ownerGrant === null ? null : readStringField(value.ownerGrant);
	if (value.ownerGrant !== undefined && value.ownerGrant !== null && !ownerGrant) {
		return null;
	}

	if (value.rotateCredential !== undefined && typeof value.rotateCredential !== "boolean") {
		return null;
	}

	return { ownerGrant, rotateCredential: value.rotateCredential === true };
}

// Parses the local agent's auth payload, including its optional owner grant
// and server URL hint.
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
	if (
		(value.ownerGrant !== undefined && value.ownerGrant !== null && !ownerGrant) ||
		(value.rotateCredential !== undefined && typeof value.rotateCredential !== "boolean")
	) {
		return null;
	}

	return {
		agentId,
		agentKey,
		...(serverUrl ? { serverUrl } : {}),
		ownerGrant,
		rotateCredential: value.rotateCredential === true,
	};
}

// Validates the envelope an agent uses when pushing a server message back to a
// specific browser client.
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
