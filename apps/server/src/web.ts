import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import {
	RELAY_BOOTSTRAP_PATH,
	RELAY_SESSION_ACTION,
	normalizeRelayPairingCode,
	normalizeRelayPrincipalId,
	type RelayClientBootstrapRequest,
	type RelayClientBootstrapResponse,
} from "@apreal/shared";
import { generateToken } from "../../relay-server/src/auth.ts";
import { getConfiguredToolsLabel } from "./agent-tools.ts";
import { createRelayAgentClient } from "./relay-client.ts";
import {
	parseClientAppMessage,
	type ClientAppMessage,
	type ServerAppMessage,
} from "./protocol.ts";
import {
	createAgentController,
	formatModelLabel,
	getErrorMessage,
	prewarmAgentRuntime,
	type AgentController,
	type AgentStreamEvent,
} from "./session.ts";
import {
	assertRelayServerTransportConfig,
	getServerTransportConfig,
	type RelayAgentTokenProvider,
} from "./transport-config.ts";
import { createLogger, summarizePrompt } from "./logger.ts";

const DEFAULT_PORT = 3000;
const SERVER_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_ROOT = join(SERVER_SRC_DIR, "..", "..", "..");

type ClientTransport = "relay";

type ServerMessage = ServerAppMessage<SessionSummary, TranscriptMessage>;

type ClientConnection = {
	clientId: string;
	closed: boolean;
	ready: boolean;
	transport: ClientTransport;
	send(payload: ServerMessage): boolean | void;
};

type TranscriptMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "error";
	body: string;
	thinking: string;
	toolCalls: TranscriptToolCall[];
	segments: TranscriptMessageSegment[];
	pending: boolean;
	createdAt: number;
};

type TranscriptToolCall = {
	id: string;
	name: string;
	summary: string;
	status: "running" | "completed" | "failed";
	createdAt: number;
	updatedAt: number;
};

type TranscriptThinkingSegment = {
	id: string;
	type: "thinking";
	content: string;
	contentIndex?: number;
	createdAt: number;
	updatedAt: number;
};

type TranscriptTextSegment = {
	id: string;
	type: "text";
	content: string;
	contentIndex?: number;
	createdAt: number;
	updatedAt: number;
};

type TranscriptToolCallSegment = TranscriptToolCall & {
	type: "tool_call";
	contentIndex?: number;
};

type TranscriptMessageSegment = TranscriptTextSegment | TranscriptThinkingSegment | TranscriptToolCallSegment;

type SharedSessionState = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	abortRequested: boolean;
	model: string | null;
	controller: AgentController | null;
	controllerPromise: Promise<AgentController> | null;
	unsubscribe: (() => void) | null;
	transcript: TranscriptMessage[];
	pendingAssistantMessageId: string | null;
	toolCallMessageIds: Map<string, string>;
};

type SessionSummary = {
	id: string;
	title: string;
	preview: string;
	createdAt: number;
	updatedAt: number;
	busy: boolean;
	model: string | null;
	messageCount: number;
};

function parsePort(rawPort: string | undefined): number {
	const candidate = Number.parseInt(rawPort ?? `${DEFAULT_PORT}`, 10);
	if (Number.isNaN(candidate) || candidate <= 0) {
		return DEFAULT_PORT;
	}

	return candidate;
}

function mergeResponseHeaders(headers?: ResponseInit["headers"]): Record<string, string> {
	const mergedHeaders: Record<string, string> = {
		"cache-control": "no-store",
	};

	if (!headers) {
		return mergedHeaders;
	}

	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			mergedHeaders[key] = value;
		});
		return mergedHeaders;
	}

	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			mergedHeaders[key] = value;
		}
		return mergedHeaders;
	}

	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "string") {
			mergedHeaders[key] = value;
			continue;
		}

		if (Array.isArray(value)) {
			mergedHeaders[key] = value.join(", ");
		}
	}

	return mergedHeaders;
}

function json(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, {
		...init,
		headers: mergeResponseHeaders(init?.headers),
	});
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createCorsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "POST, OPTIONS",
		"access-control-allow-headers": "content-type",
	};
}

async function parseRelayBootstrapRequest(request: Request): Promise<RelayClientBootstrapRequest | null> {
	let value: unknown;
	try {
		value = await request.json();
	} catch {
		return null;
	}

	if (!isObjectRecord(value)) {
		return null;
	}

	const clientId = normalizeRelayPrincipalId(value.clientId);
	if (!clientId) {
		return null;
	}

	return { clientId };
}

function createSessionTitle(prompt: string): string {
	return summarizePrompt(prompt, 42) || "New chat";
}

function createSessionPreview(transcript: TranscriptMessage[]): string {
	for (let index = transcript.length - 1; index >= 0; index -= 1) {
		const entry = transcript[index];
		if (!entry) {
			continue;
		}

		const body = entry.body.trim();
		if (!body) {
			continue;
		}

		return summarizePrompt(body, 72);
	}

	return "No messages yet";
}

function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
	return transcript.map((entry) => ({
		...entry,
		toolCalls: entry.toolCalls.map((toolCall) => ({ ...toolCall })),
		segments: entry.segments.map((segment) => ({ ...segment })),
	}));
}

export function runWebServer(options?: { cwd?: string; port?: number }) {
	const cwd = options?.cwd ?? process.env.PI_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT;
	const port = options?.port ?? parsePort(process.env.PORT);
	const transportConfig = getServerTransportConfig();
	assertRelayServerTransportConfig(transportConfig);
	const clients = new Map<string, ClientConnection>();
	const sessions = new Map<string, SharedSessionState>();
	const logger = createLogger("web-server");
	let relayAgentClient: ReturnType<typeof createRelayAgentClient> | null = null;
	let relayPairingCode = transportConfig.relayPairingCode;
	let pairingPromptPromise: Promise<void> | null = null;
	const relayLogger = createLogger("relay-agent");
	const getRelayAgentJwt: RelayAgentTokenProvider = () => {
		if (transportConfig.relayAgentId && process.env.JWT_SECRET?.trim()) {
			return generateToken({
				type: "agent",
				id: transportConfig.relayAgentId,
				pairingCode: relayPairingCode ?? undefined,
			});
		}

		return process.env.PI_RELAY_AGENT_JWT?.trim() || null;
	};

	async function ensureRelayPairingCode(reason: string) {
		if (relayPairingCode) {
			return;
		}

		if (pairingPromptPromise) {
			return pairingPromptPromise;
		}

		pairingPromptPromise = (async () => {
			const prompt = createInterface({ input, output });
			try {
				const answer = await prompt.question(
					`Relay pairing required (${reason}). Paste the pairing code from the web client: `,
				);
				const normalized = normalizeRelayPairingCode(answer);
				if (!normalized) {
					throw new Error("Invalid relay pairing code.");
				}

				relayPairingCode = normalized;
				logger.info("stored relay pairing code for this server process");
			} finally {
				prompt.close();
				pairingPromptPromise = null;
			}
		})();

		return pairingPromptPromise;
	}

	function disposeRelayAgentClient() {
		if (!relayAgentClient) {
			return;
		}

		relayAgentClient.dispose();
		relayAgentClient = null;
	}

	function startRelayAgentClient() {
		if (relayAgentClient || !relayPairingCode) {
			return;
		}

		relayAgentClient = createRelayAgentClient({
			relayUrl: transportConfig.relayUrl!,
			agentId: transportConfig.relayAgentId,
			getAgentJwt() {
				const token = getRelayAgentJwt();
				if (!token) {
					throw new Error("PI_RELAY_AGENT_JWT is required");
				}

				return token;
			},
			logger: relayLogger,
			onClientMessage(clientId, payload) {
				void handleRelayPayload(clientId, payload);
			},
			onDisconnect(_code, reason) {
				if (reason === "pairing_required" || reason === "pairing_invalid" || reason === "pairing_expired") {
					disposeRelayAgentClient();
					relayPairingCode = null;
					void ensureRelayPairingCode(reason).then(() => {
						startRelayAgentClient();
					});
				}
				removeRelayClients("relay_transport_closed");
			},
		});
	}

	async function handleRelayBootstrapRequest(request: Request): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}

		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}

		const bootstrapRequest = await parseRelayBootstrapRequest(request);
		if (!bootstrapRequest) {
			return json(
				{ message: "Invalid relay bootstrap request." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}

		const relayAgentId = normalizeRelayPrincipalId(transportConfig.relayAgentId);
		if (!relayAgentId || !transportConfig.relayUrl) {
			return json(
				{ message: "Relay transport is not configured." },
				{ status: 500, headers: createCorsHeaders() },
			);
		}

		try {
			const relayResponse = await fetch(RELAY_BOOTSTRAP_PATH, {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify(bootstrapRequest satisfies RelayClientBootstrapRequest),
			});

			if (!relayResponse.ok) {
				return json(
					{ message: `relay bootstrap failed with status ${relayResponse.status}` },
					{ status: 502, headers: createCorsHeaders() },
				);
			}

			const response = (await relayResponse.json()) as RelayClientBootstrapResponse;

			return json(response, {
				status: 200,
				headers: createCorsHeaders(),
			});
		} catch (error) {
			logger.error("failed to issue relay bootstrap token", {
				clientId: bootstrapRequest.clientId,
				error: getErrorMessage(error),
			});
			return json(
				{ message: getErrorMessage(error) },
				{ status: 500, headers: createCorsHeaders() },
			);
		}
	}

	function sendClientPayload(
		clientId: string,
		payload: ServerMessage,
		options?: { requireReady?: boolean },
	): boolean {
		const client = clients.get(clientId);
		if (!client || client.closed) {
			return false;
		}

		if ((options?.requireReady ?? true) && !client.ready) {
			return false;
		}

		try {
			return client.send(payload) !== false;
		} catch (error) {
			logger.warn("failed to send client payload", {
				clientId,
				transport: client.transport,
				error: getErrorMessage(error),
			});
			return false;
		}
	}

	function registerClientConnection(
		clientId: string,
		transport: ClientTransport,
		sendPayload: ClientConnection["send"],
	) {
		const existing = clients.get(clientId);
		if (existing) {
			existing.closed = false;
			existing.transport = transport;
			existing.send = sendPayload;
			return existing;
		}

		const connection: ClientConnection = {
			clientId,
			closed: false,
			ready: false,
			transport,
			send: sendPayload,
		};
		clients.set(clientId, connection);
		logger.info("client transport connected", {
			clientId,
			transport,
			clients: clients.size,
		});
		return connection;
	}

	function removeClientConnection(clientId: string, reason: string) {
		const client = clients.get(clientId);
		if (!client) {
			return;
		}

		client.closed = true;
		clients.delete(clientId);
		logger.info("client transport disconnected", {
			clientId,
			transport: client.transport,
			reason,
			clients: clients.size,
		});
	}

	function removeRelayClients(reason: string) {
		for (const client of Array.from(clients.values())) {
			removeClientConnection(client.clientId, reason);
		}
	}

	function sendError(clientId: string, message: string, sessionId?: string) {
		sendClientPayload(clientId, { type: "error", message, sessionId }, { requireReady: false });
	}

	function buildSessionSummary(session: SharedSessionState): SessionSummary {
		return {
			id: session.id,
			title: session.title,
			preview: createSessionPreview(session.transcript),
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			busy: session.busy,
			model: session.model,
			messageCount: session.transcript.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
		};
	}

	function listSessions(): SessionSummary[] {
		return Array.from(sessions.values())
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.map(buildSessionSummary);
	}

	function broadcast(payload: ServerMessage) {
		for (const client of clients.values()) {
			if (client.closed || !client.ready) {
				continue;
			}

			sendClientPayload(client.clientId, payload);
		}
	}

	function sendSessionsUpdated(targetClientId?: string) {
		const payload = {
			type: "sessions_updated",
			sessions: listSessions(),
		} satisfies ServerMessage;

		if (targetClientId) {
			sendClientPayload(targetClientId, payload, { requireReady: false });
			return;
		}

		broadcast(payload);
	}

	function buildSessionPayload(session: SharedSessionState) {
		return {
			session: buildSessionSummary(session),
			transcript: cloneTranscript(session.transcript),
		};
	}

	function sendSessionSnapshot(targetClientId: string, session: SharedSessionState) {
		sendClientPayload(targetClientId, {
			type: "session_snapshot",
			...buildSessionPayload(session),
		});
	}

	function broadcastSessionSnapshot(session: SharedSessionState) {
		broadcast({
			type: "session_snapshot",
			...buildSessionPayload(session),
		});
	}

	function touchSession(session: SharedSessionState) {
		session.updatedAt = Date.now();
	}

	function appendTranscriptMessage(
		session: SharedSessionState,
		message: Omit<TranscriptMessage, "createdAt">,
	) {
		session.transcript.push({
			...message,
			thinking: message.thinking ?? "",
			toolCalls: message.toolCalls ? message.toolCalls.map((toolCall) => ({ ...toolCall })) : [],
			segments: message.segments ? message.segments.map((segment) => ({ ...segment })) : [],
			createdAt: Date.now(),
		});
		touchSession(session);
	}

	function createPendingAssistantMessage(session: SharedSessionState): TranscriptMessage {
		const message: TranscriptMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			body: "",
			thinking: "",
			toolCalls: [],
			segments: [],
			pending: true,
			createdAt: Date.now(),
		};
		session.pendingAssistantMessageId = message.id;
		session.transcript.push(message);
		touchSession(session);
		return message;
	}

	function getPendingAssistantMessage(session: SharedSessionState): TranscriptMessage | null {
		if (!session.pendingAssistantMessageId) {
			return null;
		}

		const message = session.transcript.find((entry) => entry.id === session.pendingAssistantMessageId);
		if (!message) {
			session.pendingAssistantMessageId = null;
			return null;
		}

		return message;
	}

	function finalizeAssistantMessage(session: SharedSessionState) {
		const message = getPendingAssistantMessage(session);
		if (!message) {
			return;
		}

		message.pending = false;
		if (!message.body.trim() && !message.thinking.trim() && message.toolCalls.length === 0) {
			session.transcript = session.transcript.filter((entry) => entry.id !== message.id);
		}

		session.pendingAssistantMessageId = null;
		touchSession(session);
	}

	function settleSession(session: SharedSessionState) {
		finalizeAssistantMessage(session);
		session.busy = false;
		session.abortRequested = false;
		touchSession(session);
	}

	function createSharedSession(initialPrompt: string): SharedSessionState {
		const now = Date.now();
		return {
			id: crypto.randomUUID(),
			title: createSessionTitle(initialPrompt),
			createdAt: now,
			updatedAt: now,
			busy: false,
			abortRequested: false,
			model: null,
			controller: null,
			controllerPromise: null,
			unsubscribe: null,
			transcript: [],
			pendingAssistantMessageId: null,
			toolCallMessageIds: new Map(),
		};
	}

	function ensurePendingAssistantMessage(session: SharedSessionState): TranscriptMessage {
		return getPendingAssistantMessage(session) ?? createPendingAssistantMessage(session);
	}

	function findTranscriptMessage(session: SharedSessionState, messageId: string): TranscriptMessage | null {
		return session.transcript.find((entry) => entry.id === messageId) ?? null;
	}

	function getSegmentSortValue(segment: TranscriptMessageSegment): number {
		return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
	}

	function insertAssistantSegment(message: TranscriptMessage, segment: TranscriptMessageSegment) {
		const insertIndex = message.segments.findIndex(
			(existing) => getSegmentSortValue(existing) > getSegmentSortValue(segment),
		);
		if (insertIndex === -1) {
			message.segments.push(segment);
			return;
		}

		message.segments.splice(insertIndex, 0, segment);
	}

	function appendAssistantText(
		session: SharedSessionState,
		delta: string,
		contentIndex?: number,
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		message.body += delta;
		const existingSegment = message.segments.find(
			(entry): entry is TranscriptTextSegment =>
				entry.type === "text" &&
				(contentIndex !== undefined ? entry.contentIndex === contentIndex : entry === message.segments[message.segments.length - 1]),
		);
		if (existingSegment) {
			existingSegment.content += delta;
			existingSegment.updatedAt = now;
		} else {
			insertAssistantSegment(message, {
				id: crypto.randomUUID(),
				type: "text",
				content: delta,
				contentIndex,
				createdAt: now,
				updatedAt: now,
			});
		}
		touchSession(session);
		return message;
	}

	function appendAssistantThinking(
		session: SharedSessionState,
		delta: string,
		contentIndex?: number,
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		message.thinking += delta;
		const existingSegment = message.segments.find(
			(entry): entry is TranscriptThinkingSegment =>
				entry.type === "thinking" &&
				(contentIndex !== undefined ? entry.contentIndex === contentIndex : entry === message.segments[message.segments.length - 1]),
		);
		if (existingSegment) {
			existingSegment.content += delta;
			existingSegment.updatedAt = now;
		} else {
			insertAssistantSegment(message, {
				id: crypto.randomUUID(),
				type: "thinking",
				content: delta,
				contentIndex,
				createdAt: now,
				updatedAt: now,
			});
		}
		touchSession(session);
		return message;
	}

	function upsertAssistantToolCall(
		session: SharedSessionState,
		toolCall: Omit<TranscriptToolCall, "createdAt" | "updatedAt"> & { contentIndex?: number },
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		const existing = message.toolCalls.find((entry) => entry.id === toolCall.id);
		if (existing) {
			existing.name = toolCall.name;
			existing.summary = toolCall.summary;
			existing.status = toolCall.status;
			existing.updatedAt = now;
		} else {
			message.toolCalls.push({
				...toolCall,
				createdAt: now,
				updatedAt: now,
			});
		}

		const existingSegment = message.segments.find(
			(entry): entry is TranscriptToolCallSegment => entry.type === "tool_call" && entry.id === toolCall.id,
		);
		if (existingSegment) {
			existingSegment.name = toolCall.name;
			existingSegment.summary = toolCall.summary;
			existingSegment.status = toolCall.status;
			existingSegment.contentIndex = toolCall.contentIndex ?? existingSegment.contentIndex;
			existingSegment.updatedAt = now;
		} else {
			insertAssistantSegment(message, {
				...toolCall,
				type: "tool_call",
				contentIndex: toolCall.contentIndex,
				createdAt: now,
				updatedAt: now,
			});
		}

		session.toolCallMessageIds.set(toolCall.id, message.id);
		touchSession(session);
		return message;
	}

	function updateAssistantToolCallStatus(
		session: SharedSessionState,
		toolCallId: string,
		status: TranscriptToolCall["status"],
	) {
		const ownerMessageId = session.toolCallMessageIds.get(toolCallId);
		const message = ownerMessageId ? findTranscriptMessage(session, ownerMessageId) : getPendingAssistantMessage(session);
		if (!message) {
			return;
		}

		const toolCall = message.toolCalls.find((entry) => entry.id === toolCallId);
		if (!toolCall) {
			return;
		}

		toolCall.status = status;
		toolCall.updatedAt = Date.now();
		const toolSegment = message.segments.find(
			(entry): entry is TranscriptToolCallSegment => entry.type === "tool_call" && entry.id === toolCallId,
		);
		if (toolSegment) {
			toolSegment.status = status;
			toolSegment.updatedAt = toolCall.updatedAt;
		}
		touchSession(session);
	}

	function failRunningAssistantToolCalls(session: SharedSessionState) {
		let changed = false;
		for (const message of session.transcript) {
			for (const toolCall of message.toolCalls) {
				if (toolCall.status === "running") {
					toolCall.status = "failed";
					toolCall.updatedAt = Date.now();
					changed = true;
				}
			}

			for (const segment of message.segments) {
				if (segment.type === "tool_call" && segment.status === "running") {
					segment.status = "failed";
					segment.updatedAt = Date.now();
					changed = true;
				}
			}
		}

		if (changed) {
			touchSession(session);
		}
	}

	function applyAssistantMessageSnapshot(
		session: SharedSessionState,
		snapshot: Extract<AgentStreamEvent, { type: "message_end" }>,
	): TranscriptMessage {
		const message = ensurePendingAssistantMessage(session);
		const now = Date.now();
		message.body =
			snapshot.stopReason === "error" && snapshot.errorMessage && !snapshot.body.trim()
				? `Error: ${snapshot.errorMessage}`
				: snapshot.body;
		message.thinking = snapshot.thinking;
		const existingToolCalls = new Map(message.toolCalls.map((toolCall) => [toolCall.id, toolCall]));
		message.toolCalls = snapshot.toolCalls.map((toolCall) => {
			const existingToolCall = existingToolCalls.get(toolCall.id);
			return {
				id: toolCall.id,
				name: toolCall.name,
				summary: toolCall.summary,
				status: toolCall.status,
				createdAt: existingToolCall?.createdAt ?? now,
				updatedAt: now,
			};
		});

		if (snapshot.segments.length > 0) {
			const existingTextSegments = new Map(
				message.segments
					.filter((segment): segment is TranscriptTextSegment => segment.type === "text")
					.map((segment) => [segment.contentIndex ?? -1, segment]),
			);
			const existingThinkingSegments = new Map(
				message.segments
					.filter((segment): segment is TranscriptThinkingSegment => segment.type === "thinking")
					.map((segment) => [segment.contentIndex ?? -1, segment]),
			);
			const existingToolSegments = new Map(
				message.segments
					.filter((segment): segment is TranscriptToolCallSegment => segment.type === "tool_call")
					.map((segment) => [segment.id, segment]),
			);

			message.segments = snapshot.segments.map((segment) => {
				switch (segment.type) {
					case "text": {
						const existingSegment = existingTextSegments.get(segment.contentIndex);
						return {
							id: existingSegment?.id ?? crypto.randomUUID(),
							type: "text",
							content: segment.content,
							contentIndex: segment.contentIndex,
							createdAt: existingSegment?.createdAt ?? now,
							updatedAt: now,
						};
					}
					case "thinking": {
						const existingSegment = existingThinkingSegments.get(segment.contentIndex);
						return {
							id: existingSegment?.id ?? crypto.randomUUID(),
							type: "thinking",
							content: segment.content,
							contentIndex: segment.contentIndex,
							createdAt: existingSegment?.createdAt ?? now,
							updatedAt: now,
						};
					}
					case "tool_call": {
						const existingSegment = existingToolSegments.get(segment.id);
						return {
							id: segment.id,
							name: segment.name,
							summary: segment.summary,
							status: segment.status,
							type: "tool_call",
							contentIndex: segment.contentIndex,
							createdAt: existingSegment?.createdAt ?? now,
							updatedAt: now,
						};
					}
				}
			});
		}

		for (const toolCall of message.toolCalls) {
			if (message.segments.some((segment) => segment.type === "tool_call" && segment.id === toolCall.id)) {
				continue;
			}

			insertAssistantSegment(message, {
				...toolCall,
				type: "tool_call",
				createdAt: toolCall.createdAt,
				updatedAt: toolCall.updatedAt,
			});
		}

		touchSession(session);
		return message;
	}

	function handleControllerEvent(session: SharedSessionState, event: AgentStreamEvent) {
		switch (event.type) {
			case "assistant_message_start": {
				if (!getPendingAssistantMessage(session)) {
					createPendingAssistantMessage(session);
					broadcastSessionSnapshot(session);
				}
				break;
			}
			case "message_end": {
				applyAssistantMessageSnapshot(session, event);
				finalizeAssistantMessage(session);
				broadcastSessionSnapshot(session);
				break;
			}
			case "text_delta": {
				const message = appendAssistantText(session, event.delta, event.contentIndex);
				broadcast({
					type: "assistant_delta",
					sessionId: session.id,
					messageId: message.id,
					delta: event.delta,
					contentIndex: event.contentIndex,
				});
				break;
			}
			case "thinking_delta": {
				const message = appendAssistantThinking(session, event.delta, event.contentIndex);
				broadcast({
					type: "assistant_thinking_delta",
					sessionId: session.id,
					messageId: message.id,
					delta: event.delta,
					contentIndex: event.contentIndex,
				});
				break;
			}
			case "tool_call": {
				upsertAssistantToolCall(session, {
					id: event.tool.id,
					name: event.tool.name,
					summary: event.tool.summary,
					status: event.tool.status,
					contentIndex: event.contentIndex,
				});
				broadcastSessionSnapshot(session);
				break;
			}
			case "tool_execution_start": {
				updateAssistantToolCallStatus(session, event.tool.id, event.tool.status);
				broadcastSessionSnapshot(session);
				break;
			}
			case "tool_execution_end": {
				updateAssistantToolCallStatus(session, event.toolId, event.status);
				broadcastSessionSnapshot(session);
				break;
			}
			case "done": {
				settleSession(session);
				broadcastSessionSnapshot(session);
				sendSessionsUpdated();
				break;
			}
			case "error": {
				const aborted = session.abortRequested;
				failRunningAssistantToolCalls(session);
				settleSession(session);
				if (!aborted) {
					appendTranscriptMessage(session, {
						id: crypto.randomUUID(),
						role: "error",
						body: `Error: ${event.message}`,
						thinking: "",
						toolCalls: [],
						segments: [],
						pending: false,
					});
				}

				broadcastSessionSnapshot(session);
				sendSessionsUpdated();
				break;
			}
		}
	}

	async function ensureController(session: SharedSessionState) {
		const sessionLogger = createLogger(`web-session:${session.id}`);
		if (session.controller) {
			return session.controller;
		}

		if (session.controllerPromise) {
			return session.controllerPromise;
		}

		session.controllerPromise = (async () => {
			sessionLogger.info("creating shared browser session", { cwd, sessionId: session.id });
			const controller = await createAgentController(cwd, {
				sessionId: session.id,
				transport: "websocket",
			});
			session.controller = controller;
			session.model = formatModelLabel(controller.model);
			session.unsubscribe = controller.subscribe((event) => {
				handleControllerEvent(session, event);
			});
			touchSession(session);
			sendSessionsUpdated();
			return controller;
		})();

		try {
			return await session.controllerPromise;
		} finally {
			session.controllerPromise = null;
		}
	}

	async function handlePrompt(
		clientId: string,
		prompt: string,
		sessionId?: string | null,
	) {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			sendError(clientId, "Prompt cannot be empty.");
			return;
		}

		let session = sessionId ? sessions.get(sessionId) : null;
		const createdSession = !session;
		if (sessionId && !session) {
			sendError(clientId, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session) {
			session = createSharedSession(trimmedPrompt);
			sessions.set(session.id, session);
		}

		if (session.busy) {
			sendError(
				clientId,
				"The selected session is still responding. Wait for it to finish or abort the current run.",
				session.id,
			);
			return;
		}

		session.abortRequested = false;
		session.busy = true;
		appendTranscriptMessage(session, {
			id: crypto.randomUUID(),
			role: "user",
			body: trimmedPrompt,
			thinking: "",
			toolCalls: [],
			segments: [],
			pending: false,
		});
		createPendingAssistantMessage(session);

		if (createdSession) {
			sendClientPayload(clientId, {
				type: "session_created",
				...buildSessionPayload(session),
			}, { requireReady: false });
		} else {
			broadcastSessionSnapshot(session);
		}
		sendSessionsUpdated();

		try {
			const controller = await ensureController(session);
			if (controller.isStreaming()) {
				throw new Error(
					"The selected session is still responding. Wait for it to finish or abort the current run.",
				);
			}

			await controller.prompt(trimmedPrompt);
			if (session.busy && !controller.isStreaming()) {
				settleSession(session);
				broadcastSessionSnapshot(session);
				sendSessionsUpdated();
			}
		} catch (error) {
			logger.error("browser prompt failed", {
				sessionId: session.id,
				error: getErrorMessage(error),
			});
			settleSession(session);
			appendTranscriptMessage(session, {
				id: crypto.randomUUID(),
				role: "error",
				body: `Error: ${getErrorMessage(error)}`,
				thinking: "",
				toolCalls: [],
				segments: [],
				pending: false,
			});
			broadcastSessionSnapshot(session);
			sendSessionsUpdated();
			sendError(clientId, getErrorMessage(error), session.id);
		}
	}

	async function handleAbort(clientId: string, sessionId: string) {
		const session = sessions.get(sessionId);
		if (!session) {
			sendError(clientId, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session.busy) {
			sendSessionSnapshot(clientId, session);
			return;
		}

		session.abortRequested = true;
		try {
			if (session.controller) {
				await session.controller.abort();
			} else if (session.controllerPromise) {
				const controller = await session.controllerPromise;
				await controller.abort();
			}
		} catch (error) {
			logger.error("abort failed", {
				sessionId,
				error: getErrorMessage(error),
			});
			sendError(clientId, getErrorMessage(error), sessionId);
		} finally {
			settleSession(session);
			appendTranscriptMessage(session, {
				id: crypto.randomUUID(),
				role: "system",
				body: "Response aborted.",
				thinking: "",
				toolCalls: [],
				segments: [],
				pending: false,
			});
			broadcastSessionSnapshot(session);
			sendSessionsUpdated();
		}
	}

	function sendConnected(clientId: string) {
		sendClientPayload(
			clientId,
			{
				type: "connected",
				clientId,
				message: "Connected. Browser chats are shared across tabs while the server is running.",
				tools: getConfiguredToolsLabel(),
			},
			{ requireReady: false },
		);
	}

	async function handleClientMessage(clientId: string, message: ClientAppMessage) {
		const client = clients.get(clientId);
		if (!client || client.closed) {
			logger.warn("message received for missing client", { clientId, type: message.type });
			return;
		}

		if (message.type === "hello") {
			client.ready = true;
			sendConnected(clientId);
			sendSessionsUpdated(clientId);
			return;
		}

		if (message.type === "disconnect") {
			removeClientConnection(clientId, "client_requested_disconnect");
			return;
		}

		if (!client.ready) {
			sendError(clientId, "Client must send hello before other messages.");
			return;
		}

		switch (message.type) {
			case "prompt": {
				await handlePrompt(clientId, message.prompt, message.sessionId);
				break;
			}
			case "abort": {
				await handleAbort(clientId, message.sessionId);
				break;
			}
			case "load_session": {
				const session = sessions.get(message.sessionId);
				if (!session) {
					sendError(clientId, "The selected session could not be found.", message.sessionId);
					return;
				}

				sendSessionSnapshot(clientId, session);
				break;
			}
			case "ping": {
				sendClientPayload(clientId, { type: "pong" }, { requireReady: false });
				break;
			}
		}
	}

	async function handleRelayPayload(clientId: string, payload: unknown) {
		const relayClient = relayAgentClient;
		if (!relayClient) {
			logger.warn("dropping relay payload because relay client is unavailable", {
				clientId,
			});
			return;
		}

		registerClientConnection(clientId, "relay", (message) => relayClient.sendToClient(clientId, message));
		const message = parseClientAppMessage(payload);
		if (!message) {
			logger.warn("invalid relay payload", { clientId });
			sendError(clientId, "Invalid message payload.");
			return;
		}

		logger.debug("relay client message received", {
			clientId,
			type: message.type,
			action: RELAY_SESSION_ACTION,
		});

		await handleClientMessage(clientId, message);
	}

	if (relayPairingCode) {
		startRelayAgentClient();
	} else {
		void ensureRelayPairingCode("startup").then(() => {
			startRelayAgentClient();
		});
	}

	void prewarmAgentRuntime().catch((error) => {
		logger.warn("agent runtime prewarm failed", {
			error: getErrorMessage(error),
		});
	});

	let server: ReturnType<typeof Bun.serve>;
	try {
		server = Bun.serve({
			port,
			async fetch(request) {
				const url = new URL(request.url);
				logger.debug("incoming request", {
					method: request.method,
					path: url.pathname,
				});
				if (url.pathname === RELAY_BOOTSTRAP_PATH) {
					return handleRelayBootstrapRequest(request);
				}

				if (url.pathname === "/health") {
					return json({
						status: "ok",
						transport: "relay",
						clients: clients.size,
						sessions: sessions.size,
						cwd,
					});
				}

				return new Response("Not Found", { status: 404 });
			},
		});
	} catch (error) {
		logger.error("failed to start web server", {
			port,
			error: getErrorMessage(error),
		});
		throw error;
	}

	logger.info("web server ready", {
		cwd,
		port: server.port,
		logLevel: process.env.LOG_LEVEL ?? "info",
		transport: "relay",
	});
	console.log(`Pi web server ready in ${cwd}`);
	console.log("Frontend UI: http://localhost:5173");
	console.log(`Health check: http://localhost:${server.port}/health`);
	console.log(`Relay endpoint: ${transportConfig.relayUrl}`);
	console.log(`Relay agent id: ${transportConfig.relayAgentId}`);
	console.log("Browser chat sessions are shared across tabs while the server is running.");

	return server;
}

if (import.meta.main) {
	runWebServer();
}
