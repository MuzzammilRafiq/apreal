import assert from "node:assert/strict";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import {
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	RELAY_AGENT_AUTH_PATH,
	RELAY_AGENT_MESSAGE_PATH,
	RELAY_AGENT_STREAM_PATH,
	RELAY_CLIENT_AUTH_PATH,
	RELAY_CLIENT_HEARTBEAT_PATH,
	SYNC_LAST_SEQ_QUERY_PARAM,
	type RelayAgentAuthResponse,
	type RelayAgentCommand,
	type RelayAgentMessage,
	type RelayClientAuthResponse,
	type RelayClientHeartbeatResponse,
} from "@apreal/shared";

type RelayServerModule = typeof import("../index.ts");
type RelayAuthModule = typeof import("../auth.ts");

process.env.BETTER_AUTH_SECRET = "";
process.env.BETTER_AUTH_GOOGLE_CLIENT_ID = "";
process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET = "";

const relayEntryPoint = fileURLToPath(import.meta.url).includes(`${sep}dist${sep}`)
	? "../index.js"
	: "../index.ts";
const { runRelayServer } = (await import(relayEntryPoint)) as RelayServerModule;
const authEntryPoint = fileURLToPath(import.meta.url).includes(`${sep}dist${sep}`)
	? "../auth.js"
	: "../auth.ts";
const { generateOwnerAgentGrant } = (await import(authEntryPoint)) as RelayAuthModule;

type JsonResult<T> = {
	status: number;
	body: T;
};

type SseWaiter = {
	resolve(value: unknown | null): void;
	reject(error: unknown): void;
	timer?: ReturnType<typeof setTimeout>;
};

type SseStream = {
	next<T>(timeoutMs?: number): Promise<T | null>;
	close(): Promise<void>;
};

type PairContext = {
	client: RelayClientAuthResponse;
	agent: RelayAgentAuthResponse;
	clientStream: SseStream;
	agentStream: SseStream;
};

async function postJson<T>(
	baseUrl: string,
	path: string,
	body: unknown,
	options?: { headers?: Record<string, string> },
): Promise<JsonResult<T>> {
	const response = await fetch(`${baseUrl}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(options?.headers ?? {}),
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();
	return {
		status: response.status,
		body: text ? (JSON.parse(text) as T) : (null as T),
	};
}

async function openSseStream(url: string, options?: { headers?: Record<string, string> }): Promise<SseStream> {
	const controller = new AbortController();
	const response = await fetch(url, {
		method: "GET",
		headers: options?.headers,
		signal: controller.signal,
	});
	assert.equal(response.status, 200, `Expected SSE stream ${url} to return 200.`);
	assert.ok(response.body, `Expected SSE stream ${url} to provide a response body.`);

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const queuedEvents: unknown[] = [];
	const waiters: SseWaiter[] = [];
	let buffer = "";
	let closed = false;

	const resolveEvent = (event: unknown) => {
		const waiter = waiters.shift();
		if (!waiter) {
			queuedEvents.push(event);
			return;
		}

		if (waiter.timer) {
			clearTimeout(waiter.timer);
		}
		waiter.resolve(event);
	};

	const rejectAll = (error: unknown) => {
		closed = true;
		while (waiters.length > 0) {
			const waiter = waiters.shift();
			if (!waiter) {
				continue;
			}

			if (waiter.timer) {
				clearTimeout(waiter.timer);
			}
			waiter.reject(error);
		}
	};

	const pump = (async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					rejectAll(new Error("SSE stream closed."));
					return;
				}

				buffer += decoder.decode(value, { stream: true });
				while (true) {
					const boundary = buffer.indexOf("\n\n");
					if (boundary < 0) {
						break;
					}

					const rawEvent = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);

					const payload = rawEvent
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n");
					if (!payload) {
						continue;
					}

					resolveEvent(JSON.parse(payload));
				}
			}
		} catch (error) {
			if (controller.signal.aborted) {
				rejectAll(new Error("SSE stream aborted."));
				return;
			}

			rejectAll(error);
		}
	})();

	return {
		next<T>(timeoutMs = 1_000) {
			if (queuedEvents.length > 0) {
				return Promise.resolve(queuedEvents.shift() as T);
			}

			if (closed) {
				return Promise.reject(new Error("SSE stream closed."));
			}

			return new Promise<T | null>((resolve, reject) => {
				const waiter: SseWaiter = {
					resolve,
					reject,
					timer: setTimeout(() => {
						const index = waiters.indexOf(waiter);
						if (index >= 0) {
							waiters.splice(index, 1);
						}
						resolve(null);
					}, timeoutMs),
				};
				waiters.push(waiter);
			});
		},
		async close() {
			if (controller.signal.aborted) {
				return;
			}

			controller.abort();
			try {
				await pump;
			} catch {
				// Ignore teardown errors from an aborted test stream.
			}
		},
	};
}

async function startRelayTestServer(t: TestContext, options?: { tempDir?: string }) {
	const previousOwnerBindingStorePath = process.env.RELAY_OWNER_BINDING_STORE_PATH;
	const previousTokenStorePath = process.env.RELAY_TOKEN_STORE_PATH;
	const previousJwtSecret = process.env.JWT_SECRET;
	const tempDir = options?.tempDir ?? mkdtempSync(join(tmpdir(), "relay-isolation-"));
	process.env.RELAY_OWNER_BINDING_STORE_PATH = join(tempDir, "relay-owner-bindings.json");
	delete process.env.RELAY_TOKEN_STORE_PATH;
	process.env.JWT_SECRET = "relay-test-secret";

	const server = runRelayServer({ port: 0 });
	if (!server.listening) {
		await new Promise<void>((resolve) => {
			server.once("listening", () => resolve());
		});
	}

	const address = server.address();
	assert.ok(address && typeof address === "object", "Expected relay server to expose a bound address.");

	t.after(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}

				resolve();
			});
			server.closeAllConnections?.();
		});
		if (!options?.tempDir) {
			rmSync(tempDir, { force: true, recursive: true });
		}
		if (previousOwnerBindingStorePath === undefined) {
			delete process.env.RELAY_OWNER_BINDING_STORE_PATH;
		} else {
			process.env.RELAY_OWNER_BINDING_STORE_PATH = previousOwnerBindingStorePath;
		}
		if (previousTokenStorePath === undefined) {
			delete process.env.RELAY_TOKEN_STORE_PATH;
		} else {
			process.env.RELAY_TOKEN_STORE_PATH = previousTokenStorePath;
		}
		if (previousJwtSecret === undefined) {
			delete process.env.JWT_SECRET;
		} else {
			process.env.JWT_SECRET = previousJwtSecret;
		}
	});

	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		tempDir,
	};
}

async function issueClientAuth(baseUrl: string, clientId: string, clientKey: string, ownerGrant: string) {
	const response = await postJson<RelayClientAuthResponse>(baseUrl, RELAY_CLIENT_AUTH_PATH, {
		clientId,
		clientKey,
		ownerGrant,
	});
	assert.equal(response.status, 200, `Expected client auth for ${clientId} to succeed.`);
	assert.equal(response.body.paired, false, `Expected client ${clientId} to start unpaired.`);
	return response.body;
}

async function issueAgentAuth(baseUrl: string, agentId: string, agentKey: string, ownerGrant: string) {
	const response = await postJson<RelayAgentAuthResponse>(baseUrl, RELAY_AGENT_AUTH_PATH, {
		agentId,
		agentKey,
		ownerGrant,
	});
	assert.equal(response.status, 200, `Expected agent auth for ${agentId} to succeed.`);
	return response.body;
}

async function refreshClientAuth(baseUrl: string, client: RelayClientAuthResponse, ownerGrant: string) {
	const response = await postJson<RelayClientAuthResponse>(baseUrl, RELAY_CLIENT_AUTH_PATH, {
		clientId: client.clientId,
		clientKey: client.clientKey,
		ownerGrant,
	});
	assert.equal(response.status, 200, `Expected client auth refresh for ${client.clientId} to succeed.`);
	assert.equal(response.body.paired, true, `Expected client ${client.clientId} to be paired after agent auth.`);
	assert.ok(response.body.target, `Expected client ${client.clientId} to expose its paired target.`);
	return response.body;
}

async function assertClientSettingsAuthorization(baseUrl: string, client: RelayClientAuthResponse, ownerGrant: string) {
	const response = await postJson<RelayClientHeartbeatResponse>(baseUrl, RELAY_CLIENT_HEARTBEAT_PATH, {
		clientId: client.clientId,
		clientKey: client.clientKey,
		ownerGrant,
	});
	assert.equal(response.status, 200, `Expected client heartbeat for ${client.clientId} to succeed.`);
	assert.deepEqual(response.body.settingsAuthorization, { sections: ["account"] });
}

async function createPair(t: TestContext, baseUrl: string, suffix: string): Promise<PairContext> {
	const ownerGrant = generateOwnerAgentGrant(`owner-${suffix}`).ownerGrant;
	const initialClient = await issueClientAuth(baseUrl, `client-${suffix}`, `client-key-${suffix}`, ownerGrant);
	const agent = await issueAgentAuth(baseUrl, `agent-${suffix}`, `agent-key-${suffix}`, ownerGrant);
	const client = await refreshClientAuth(baseUrl, initialClient, ownerGrant);
	await assertClientSettingsAuthorization(baseUrl, client, ownerGrant);
	const agentStream = await openSseStream(`${baseUrl}${RELAY_AGENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${agent.token}`,
		},
	});
	t.after(async () => {
		await agentStream.close();
	});

	const clientStream = await openSseStream(`${baseUrl}${CLIENT_EVENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${client.token}`,
		},
	});
	t.after(async () => {
		await clientStream.close();
	});

	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_connect",
		clientId: client.clientId,
	});

	return {
		client,
		agent,
		clientStream,
		agentStream,
	};
}

test("allows only configured relay browser origins", async (t) => {
	const previousAllowedOrigins = process.env.RELAY_CORS_ALLOW_ORIGINS;
	process.env.RELAY_CORS_ALLOW_ORIGINS = "https://app.example.com";
	t.after(() => {
		if (previousAllowedOrigins === undefined) {
			delete process.env.RELAY_CORS_ALLOW_ORIGINS;
			return;
		}

		process.env.RELAY_CORS_ALLOW_ORIGINS = previousAllowedOrigins;
	});

	const { baseUrl } = await startRelayTestServer(t);

	const allowedResponse = await fetch(`${baseUrl}${RELAY_CLIENT_AUTH_PATH}`, {
		method: "OPTIONS",
		headers: {
			origin: "https://app.example.com",
			"access-control-request-method": "POST",
		},
	});
	assert.equal(allowedResponse.status, 204);
	assert.equal(allowedResponse.headers.get("access-control-allow-origin"), "https://app.example.com");
	assert.equal(allowedResponse.headers.get("access-control-allow-credentials"), "true");

	const blockedResponse = await fetch(`${baseUrl}${RELAY_CLIENT_AUTH_PATH}`, {
		method: "OPTIONS",
		headers: {
			origin: "https://evil.example.com",
			"access-control-request-method": "POST",
		},
	});
	assert.equal(blockedResponse.status, 204);
	assert.equal(blockedResponse.headers.get("access-control-allow-origin"), null);
	assert.equal(blockedResponse.headers.get("access-control-allow-credentials"), null);
});

test("routes client traffic only to the paired agent", async (t) => {
	const { baseUrl } = await startRelayTestServer(t);
	const pairA = await createPair(t, baseUrl, "a");
	const pairB = await createPair(t, baseUrl, "b");

	const clientMessage = {
		type: "prompt",
		prompt: "hello from client a",
	};
	const response = await postJson<{ ok: true }>(baseUrl, CLIENT_MESSAGE_PATH, clientMessage, {
		headers: {
			authorization: `Bearer ${pairA.client.token}`,
		},
	});
	assert.equal(response.status, 202);

	assert.deepEqual(await pairA.agentStream.next<RelayAgentCommand>(), {
		type: "client_message",
		clientId: pairA.client.clientId,
		message: clientMessage,
	});
	assert.equal(await pairB.agentStream.next<RelayAgentCommand>(150), null);
});

test("forwards browser reconnect cursor to the paired agent", async (t) => {
	const { baseUrl } = await startRelayTestServer(t);
	const ownerGrant = generateOwnerAgentGrant("owner-reconnect-cursor").ownerGrant;
	const initialClient = await issueClientAuth(baseUrl, "client-reconnect-cursor", "client-key-reconnect-cursor", ownerGrant);
	const agent = await issueAgentAuth(baseUrl, "agent-reconnect-cursor", "agent-key-reconnect-cursor", ownerGrant);
	const client = await refreshClientAuth(baseUrl, initialClient, ownerGrant);
	const agentStream = await openSseStream(`${baseUrl}${RELAY_AGENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${agent.token}`,
		},
	});
	t.after(async () => {
		await agentStream.close();
	});

	const streamUrl = new URL(`${baseUrl}${CLIENT_EVENT_STREAM_PATH}`);
	streamUrl.searchParams.set(SYNC_LAST_SEQ_QUERY_PARAM, "42");
	const clientStream = await openSseStream(streamUrl.toString(), {
		headers: {
			authorization: `Bearer ${client.token}`,
		},
	});
	t.after(async () => {
		await clientStream.close();
	});

	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_connect",
		clientId: client.clientId,
		lastSeq: 42,
	});
});

test("replacing a browser stream keeps the logical client connected", async (t) => {
	const { baseUrl } = await startRelayTestServer(t);
	const ownerGrant = generateOwnerAgentGrant("owner-browser-replace").ownerGrant;
	const initialClient = await issueClientAuth(baseUrl, "client-browser-replace", "client-key-browser-replace", ownerGrant);
	const agent = await issueAgentAuth(baseUrl, "agent-browser-replace", "agent-key-browser-replace", ownerGrant);
	const client = await refreshClientAuth(baseUrl, initialClient, ownerGrant);
	const agentStream = await openSseStream(`${baseUrl}${RELAY_AGENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${agent.token}`,
		},
	});
	t.after(async () => {
		await agentStream.close();
	});

	const firstClientStream = await openSseStream(`${baseUrl}${CLIENT_EVENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${client.token}`,
		},
	});
	t.after(async () => {
		await firstClientStream.close();
	});
	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_connect",
		clientId: client.clientId,
	});

	const replacementUrl = new URL(`${baseUrl}${CLIENT_EVENT_STREAM_PATH}`);
	replacementUrl.searchParams.set(SYNC_LAST_SEQ_QUERY_PARAM, "7");
	const replacementClientStream = await openSseStream(replacementUrl.toString(), {
		headers: {
			authorization: `Bearer ${client.token}`,
		},
	});
	t.after(async () => {
		await replacementClientStream.close();
	});

	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_connect",
		clientId: client.clientId,
		lastSeq: 7,
	});
	assert.equal(await agentStream.next<RelayAgentCommand>(150), null);
});

test("rejects agent delivery to a client paired with another agent", async (t) => {
	const { baseUrl } = await startRelayTestServer(t);
	const pairA = await createPair(t, baseUrl, "a");
	const pairB = await createPair(t, baseUrl, "b");

	const allowedMessage: RelayAgentMessage = {
		type: "server_message",
		clientId: pairA.client.clientId,
		message: {
			from: "agent-a",
		},
	};
	const allowedResponse = await postJson<{ ok: true }>(baseUrl, RELAY_AGENT_MESSAGE_PATH, allowedMessage, {
		headers: {
			authorization: `Bearer ${pairA.agent.token}`,
		},
	});
	assert.equal(allowedResponse.status, 202);
	assert.deepEqual(await pairA.clientStream.next<{ from: string }>(), {
		from: "agent-a",
	});

	const blockedResponse = await postJson<{ message: string }>(baseUrl, RELAY_AGENT_MESSAGE_PATH, {
		type: "server_message",
		clientId: pairA.client.clientId,
		message: {
			from: "agent-b",
		},
	}, {
		headers: {
			authorization: `Bearer ${pairB.agent.token}`,
		},
	});
	assert.equal(blockedResponse.status, 409);
	assert.match(blockedResponse.body.message, /Browser client stream is not connected/i);
	assert.equal(await pairA.clientStream.next(150), null);
	assert.equal(await pairB.clientStream.next(150), null);
});

test("persists owner-agent binding without persisting issued relay tokens", async (t) => {
	const tempDir = mkdtempSync(join(tmpdir(), "relay-binding-"));
	t.after(() => {
		rmSync(tempDir, { force: true, recursive: true });
	});

	const firstServer = await startRelayTestServer(t, { tempDir });
	const ownerGrant = generateOwnerAgentGrant("owner-restart").ownerGrant;
	const initialAgent = await issueAgentAuth(firstServer.baseUrl, "agent-restart", "agent-key-restart", ownerGrant);
	assert.equal(initialAgent.paired, true);

	const secondServer = await startRelayTestServer(t, { tempDir });
	const restoredAgentResponse = await postJson<RelayAgentAuthResponse>(secondServer.baseUrl, RELAY_AGENT_AUTH_PATH, {
		agentId: "agent-restart",
		agentKey: "agent-key-restart",
	});
	assert.equal(restoredAgentResponse.status, 200);
	assert.equal(restoredAgentResponse.body.agentId, "agent-restart");
	assert.equal(restoredAgentResponse.body.paired, true);

	const pairedClientResponse = await postJson<RelayClientAuthResponse>(secondServer.baseUrl, RELAY_CLIENT_AUTH_PATH, {
		clientId: "client-restart",
		clientKey: "client-key-restart",
		ownerGrant,
	});
	assert.equal(pairedClientResponse.status, 200);
	assert.equal(pairedClientResponse.body.paired, true);
	assert.deepEqual(pairedClientResponse.body.target, {
		id: "agent-restart",
		type: "agent",
	});
});

test("replaces the active owner agent when the same owner signs in elsewhere", async (t) => {
	const { baseUrl } = await startRelayTestServer(t);
	const ownerGrant = generateOwnerAgentGrant("owner-agent-singleton").ownerGrant;

	const firstAgent = await issueAgentAuth(baseUrl, "agent-first", "agent-key-first", ownerGrant);
	const firstAgentStream = await openSseStream(`${baseUrl}${RELAY_AGENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${firstAgent.token}`,
		},
	});
	t.after(async () => {
		await firstAgentStream.close();
	});

	const secondAgent = await issueAgentAuth(baseUrl, "agent-second", "agent-key-second", ownerGrant);
	assert.equal(secondAgent.paired, true);
	await assert.rejects(() => firstAgentStream.next(250), /SSE stream/);
	const replacedAgentStreamResponse = await fetch(`${baseUrl}${RELAY_AGENT_STREAM_PATH}`, {
		method: "GET",
		headers: {
			authorization: `Bearer ${firstAgent.token}`,
		},
	});
	assert.equal(replacedAgentStreamResponse.status, 401);

	const restoredFirstAgent = await postJson<RelayAgentAuthResponse>(baseUrl, RELAY_AGENT_AUTH_PATH, {
		agentId: "agent-first",
		agentKey: "agent-key-first",
	});
	assert.equal(restoredFirstAgent.status, 400);

	const pairedClientResponse = await postJson<RelayClientAuthResponse>(baseUrl, RELAY_CLIENT_AUTH_PATH, {
		clientId: "client-after-agent-replacement",
		clientKey: "client-key-after-agent-replacement",
		ownerGrant,
	});
	assert.equal(pairedClientResponse.status, 200);
	assert.deepEqual(pairedClientResponse.body.target, {
		id: "agent-second",
		type: "agent",
	});
});

test("keeps the browser stream open while the paired agent reconnects", async (t) => {
	const { baseUrl } = await startRelayTestServer(t);
	const { client, agent, clientStream, agentStream } = await createPair(t, baseUrl, "agent-reconnect");

	await agentStream.close();
	assert.equal(await clientStream.next(250), null);

	const replacementAgentStream = await openSseStream(`${baseUrl}${RELAY_AGENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${agent.token}`,
		},
	});
	t.after(async () => {
		await replacementAgentStream.close();
	});

	assert.deepEqual(await replacementAgentStream.next<RelayAgentCommand>(), {
		type: "client_connect",
		clientId: client.clientId,
	});
});

test("allows multiple owner browser clients to stay connected", async (t) => {
	const { baseUrl } = await startRelayTestServer(t);
	const ownerGrant = generateOwnerAgentGrant("owner-client-multi").ownerGrant;

	const agent = await issueAgentAuth(baseUrl, "agent-client-multi", "agent-key-client-multi", ownerGrant);
	const agentStream = await openSseStream(`${baseUrl}${RELAY_AGENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${agent.token}`,
		},
	});
	t.after(async () => {
		await agentStream.close();
	});

	const firstClientResponse = await postJson<RelayClientAuthResponse>(baseUrl, RELAY_CLIENT_AUTH_PATH, {
		clientId: "client-first",
		clientKey: "client-key-first",
		ownerGrant,
	});
	assert.equal(firstClientResponse.status, 200);
	const firstClient = firstClientResponse.body;
	const firstClientStream = await openSseStream(`${baseUrl}${CLIENT_EVENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${firstClient.token}`,
		},
	});
	t.after(async () => {
		await firstClientStream.close();
	});
	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_connect",
		clientId: "client-first",
	});

	const secondClientResponse = await postJson<RelayClientAuthResponse>(baseUrl, RELAY_CLIENT_AUTH_PATH, {
		clientId: "client-second",
		clientKey: "client-key-second",
		ownerGrant,
	});
	assert.equal(secondClientResponse.status, 200);
	assert.equal(await firstClientStream.next(150), null);

	const secondClientStream = await openSseStream(`${baseUrl}${CLIENT_EVENT_STREAM_PATH}`, {
		headers: {
			authorization: `Bearer ${secondClientResponse.body.token}`,
		},
	});
	t.after(async () => {
		await secondClientStream.close();
	});

	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_connect",
		clientId: "client-second",
	});

	const firstMessage = {
		type: "prompt",
		prompt: "hello from first browser",
	};
	const firstMessageResponse = await postJson<{ ok: true }>(baseUrl, CLIENT_MESSAGE_PATH, firstMessage, {
		headers: {
			authorization: `Bearer ${firstClient.token}`,
		},
	});
	assert.equal(firstMessageResponse.status, 202);
	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_message",
		clientId: "client-first",
		message: firstMessage,
	});

	const secondMessage = {
		type: "prompt",
		prompt: "hello from second browser",
	};
	const secondMessageResponse = await postJson<{ ok: true }>(baseUrl, CLIENT_MESSAGE_PATH, secondMessage, {
		headers: {
			authorization: `Bearer ${secondClientResponse.body.token}`,
		},
	});
	assert.equal(secondMessageResponse.status, 202);
	assert.deepEqual(await agentStream.next<RelayAgentCommand>(), {
		type: "client_message",
		clientId: "client-second",
		message: secondMessage,
	});
});
