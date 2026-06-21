import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { startWebSocketHeartbeat } from "../relay/websocket-heartbeat.ts";

async function createSocketPair(options?: { autoPong?: boolean }) {
	const server = createServer();
	const wsServer = new WebSocketServer({ server });
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	const connected = once(wsServer, "connection");
	const client = new WebSocket(`ws://127.0.0.1:${address.port}`, {
		autoPong: options?.autoPong ?? true,
	});
	const [socket] = await connected as [WebSocket];
	await once(client, "open");

	return {
		client,
		socket,
		close: async () => {
			client.terminate();
			socket.terminate();
			wsServer.close();
			server.close();
			await once(server, "close");
		},
	};
}

test("keeps a WebSocket alive while its peer answers pings", async (t) => {
	const pair = await createSocketPair();
	t.after(pair.close);
	let timedOut = false;
	const stop = startWebSocketHeartbeat(pair.socket, {
		intervalMs: 10,
		pongTimeoutMs: 20,
		onTimeout: () => {
			timedOut = true;
		},
		onError: (error) => assert.fail(error),
	});
	t.after(stop);

	await new Promise((resolve) => setTimeout(resolve, 70));
	assert.equal(timedOut, false);
});

test("times out a WebSocket whose peer stops answering pings", async (t) => {
	const pair = await createSocketPair({ autoPong: false });
	t.after(pair.close);
	const timedOut = new Promise<void>((resolve) => {
		const stop = startWebSocketHeartbeat(pair.socket, {
			intervalMs: 5,
			pongTimeoutMs: 10,
			onTimeout: resolve,
			onError: (error) => assert.fail(error),
		});
		t.after(stop);
	});

	await Promise.race([
		timedOut,
		new Promise((_, reject) => setTimeout(() => reject(new Error("heartbeat did not time out")), 100)),
	]);
});
