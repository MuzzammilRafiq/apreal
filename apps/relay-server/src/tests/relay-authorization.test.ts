import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";

import type { AuthTokenPayload } from "../auth.ts";
import {
	authorizeRelayConnection,
	mapRelayConnectionErrorStatus,
	readClientTokenFromProxyRequest,
	validateAgentServerUrl,
} from "../relay/authorization.ts";

function createPrincipal(overrides: Partial<AuthTokenPayload> = {}): AuthTokenPayload {
	return {
		type: "client",
		id: "client-one",
		credentialId: "credential-client-one",
		key: "client-key",
		targetId: "agent-one",
		targetType: "agent",
		iat: 1_700_000_000,
		exp: 1_700_003_600,
		...overrides,
	};
}

function createRequest(options: {
	url?: string;
	headers?: IncomingMessage["headers"];
} = {}): IncomingMessage {
	return {
		url: options.url ?? "/",
		headers: options.headers ?? {},
	} as IncomingMessage;
}

test("authorizes only the opposite principal role within token scope", () => {
	const principal = createPrincipal();
	assert.deepEqual(authorizeRelayConnection(principal, { targetId: "agent-one" }), {
		principal: {
			id: "client-one",
			type: "client",
			expiresAt: 1_700_003_600_000,
			scopedToTarget: true,
		},
		target: {
			id: "agent-one",
			type: "agent",
		},
	});

	for (const request of [
		{ targetId: "agent-two" },
		{ targetId: "agent-one", targetType: "client" as const },
	]) {
		assert.throws(
			() => authorizeRelayConnection(principal, request),
			(error: unknown) => mapRelayConnectionErrorStatus(error) === 403,
		);
	}

	assert.throws(
		() => authorizeRelayConnection(createPrincipal({ targetType: "client" }), { targetId: "agent-one" }),
		(error: unknown) => mapRelayConnectionErrorStatus(error) === 403,
	);
});

test("prefers bearer credentials and falls back to the EventSource query token", () => {
	assert.equal(
		readClientTokenFromProxyRequest(createRequest({
			url: "/api/client/stream?token=query-token",
			headers: { authorization: "Bearer header-token" },
		})),
		"header-token",
	);
	assert.equal(
		readClientTokenFromProxyRequest(createRequest({ url: "/api/client/stream?token=query-token" })),
		"query-token",
	);
	assert.throws(
		() => readClientTokenFromProxyRequest(createRequest({ url: "/api/client/stream?token=%20" })),
		/missing client auth token/,
	);
});

test("rejects an agent server URL that resolves back to the relay", () => {
	const request = createRequest({
		headers: {
			host: "relay.example.com",
			"x-forwarded-proto": "https",
		},
	});

	assert.throws(
		() => validateAgentServerUrl(request, "https://relay.example.com/local-agent"),
		/serverUrl must not point to the relay origin/,
	);
	assert.doesNotThrow(() => validateAgentServerUrl(request, "http://127.0.0.1:43120"));
});
