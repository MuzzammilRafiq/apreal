import {
	RELAY_CLIENT_ID_STORAGE_KEY,
	RELAY_CLIENT_TOKEN_STORAGE_KEY,
	RELAY_CLOSE_REPLACED,
	RELAY_SESSION_ACTION,
	normalizeRelayPrincipalId,
	type RelayPairingStateMessage,
	type RelayClientBootstrapResponse,
	type RelayStoredClientAuth,
} from "@apreal/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import type { SessionCacheEntry, SessionSummary, TranscriptMessage } from "./chatTypes";
import { formatSessionState } from "./chatView";
import { createRelayProtocols, getWebTransportConfig } from "./transport-config";

const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";
const RELAY_CONNECTION_OWNER_STORAGE_KEY = "pi-browser-relay-connection-owner";
const ASSISTANT_DELTA_BATCH_WINDOW_MS = 100;
const RELAY_CONNECTION_OWNER_TTL_MS = 8000;
const RELAY_CONNECTION_OWNER_HEARTBEAT_MS = 2000;
const transportConfig = getWebTransportConfig();

type RelayBootstrapSession = RelayClientBootstrapResponse;

type StoredRelayClientAuth = RelayStoredClientAuth;

type ClientMessage =
	| { type: "hello" }
	| { type: "disconnect" }
	| { type: "prompt"; prompt: string; sessionId?: string | null }
	| { type: "abort"; sessionId: string }
	| { type: "load_session"; sessionId: string }
	| { type: "ping" };

type ServerMessage =
	| { type: "connected"; clientId: string; message: string; tools?: string }
	| RelayPairingStateMessage
	| { type: "sessions_updated"; sessions: SessionSummary[] }
	| { type: "session_created"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "session_snapshot"; session: SessionSummary; transcript: TranscriptMessage[] }
	| { type: "assistant_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "assistant_thinking_delta"; sessionId: string; messageId: string; delta: string; contentIndex: number }
	| { type: "error"; message: string; sessionId?: string }
	| { type: "pong" };

type AssistantDeltaField = "body" | "thinking";

type QueuedAssistantDelta = {
	sessionId: string;
	messageId: string;
	delta: string;
	field: AssistantDeltaField;
	contentIndex: number;
};

type RelayConnectionOwner = {
	ownerId: string;
	expiresAt: number;
};

function generateId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRelayConnectionOwner(): RelayConnectionOwner | null {
	try {
		const rawValue = window.localStorage.getItem(RELAY_CONNECTION_OWNER_STORAGE_KEY);
		if (!rawValue) {
			return null;
		}

		const parsed: unknown = JSON.parse(rawValue);
		if (!isObjectRecord(parsed) || typeof parsed.ownerId !== "string" || typeof parsed.expiresAt !== "number") {
			window.localStorage.removeItem(RELAY_CONNECTION_OWNER_STORAGE_KEY);
			return null;
		}

		return {
			ownerId: parsed.ownerId,
			expiresAt: parsed.expiresAt,
		};
	} catch {
		return null;
	}
}

function writeRelayConnectionOwner(ownerId: string) {
	window.localStorage.setItem(
		RELAY_CONNECTION_OWNER_STORAGE_KEY,
		JSON.stringify({
			ownerId,
			expiresAt: Date.now() + RELAY_CONNECTION_OWNER_TTL_MS,
		} satisfies RelayConnectionOwner),
	);
}

function claimRelayConnectionOwnership(ownerId: string): boolean {
	try {
		const currentOwner = readRelayConnectionOwner();
		if (currentOwner && currentOwner.ownerId !== ownerId && currentOwner.expiresAt > Date.now()) {
			return false;
		}

		writeRelayConnectionOwner(ownerId);
		return readRelayConnectionOwner()?.ownerId === ownerId;
	} catch {
		return true;
	}
}

function renewRelayConnectionOwnership(ownerId: string): boolean {
	try {
		const currentOwner = readRelayConnectionOwner();
		if (currentOwner && currentOwner.ownerId !== ownerId && currentOwner.expiresAt > Date.now()) {
			return false;
		}

		writeRelayConnectionOwner(ownerId);
		return true;
	} catch {
		return true;
	}
}

function releaseRelayConnectionOwnership(ownerId: string) {
	try {
		const currentOwner = readRelayConnectionOwner();
		if (currentOwner?.ownerId === ownerId) {
			window.localStorage.removeItem(RELAY_CONNECTION_OWNER_STORAGE_KEY);
		}
	} catch {
		// Ignore browser storage failures.
	}
}

function createWirePayload(message: ClientMessage): string {
	return JSON.stringify({
		type: "command",
		action: RELAY_SESSION_ACTION,
		payload: message,
	});
}

function sendClientMessage(socket: WebSocket, message: ClientMessage) {
	socket.send(createWirePayload(message));
}

function parseIncomingServerMessage(rawData: unknown): ServerMessage | null {
	if (typeof rawData !== "string") {
		return null;
	}

	let value: unknown;
	try {
		value = JSON.parse(rawData);
	} catch {
		return null;
	}

	if (!isObjectRecord(value) || typeof value.type !== "string") {
		return null;
	}

	if (
		value.type === "pairing_state" &&
		(value.status === "pending" || value.status === "paired") &&
		typeof value.clientId === "string"
	) {
		return value as ServerMessage;
	}

	if (value.type === "error" && typeof value.message === "string") {
		return { type: "error", message: value.message };
	}

	if (value.action !== RELAY_SESSION_ACTION || !isObjectRecord(value.payload)) {
		return null;
	}

	return value.payload as ServerMessage;
}

function readStoredClientId(): string | null {
	try {
		return normalizeRelayPrincipalId(window.localStorage.getItem(RELAY_CLIENT_ID_STORAGE_KEY));
	} catch {
		return null;
	}
}

function storeClientId(clientId: string) {
	try {
		window.localStorage.setItem(RELAY_CLIENT_ID_STORAGE_KEY, clientId);
	} catch {
		// Ignore browser storage failures.
	}
}

function getOrCreateStoredClientId(): string {
	const existingClientId = readStoredClientId();
	if (existingClientId) {
		return existingClientId;
	}

	const clientId = generateId();
	storeClientId(clientId);
	return clientId;
}

function isStoredRelayClientAuth(value: unknown): value is StoredRelayClientAuth {
	if (!isObjectRecord(value)) {
		return false;
	}

	return (
		normalizeRelayPrincipalId(value.clientId) !== null &&
		typeof value.token === "string" &&
		value.token.trim().length > 0 &&
		typeof value.websocketUrl === "string" &&
		value.websocketUrl.trim().length > 0 &&
		typeof value.expiresAt === "number" &&
		Number.isFinite(value.expiresAt)
	);
}

function readStoredRelayClientAuth(clientId: string): StoredRelayClientAuth | null {
	try {
		const rawValue = window.localStorage.getItem(RELAY_CLIENT_TOKEN_STORAGE_KEY);
		if (!rawValue) {
			return null;
		}

		const parsed: unknown = JSON.parse(rawValue);
		if (!isStoredRelayClientAuth(parsed)) {
			window.localStorage.removeItem(RELAY_CLIENT_TOKEN_STORAGE_KEY);
			return null;
		}

		if (parsed.clientId !== clientId) {
			return null;
		}

		if (parsed.expiresAt <= Date.now()) {
			window.localStorage.removeItem(RELAY_CLIENT_TOKEN_STORAGE_KEY);
			return null;
		}

		return {
			clientId: normalizeRelayPrincipalId(parsed.clientId)!,
			token: parsed.token,
			expiresAt: parsed.expiresAt,
			websocketUrl: parsed.websocketUrl,
		};
	} catch {
		return null;
	}
}

function storeRelayClientAuth(session: RelayBootstrapSession) {
	try {
		const stored: StoredRelayClientAuth = {
			clientId: session.clientId,
			token: session.token,
			expiresAt: session.expiresAt,
			websocketUrl: session.websocketUrl,
		};
		window.localStorage.setItem(RELAY_CLIENT_TOKEN_STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// Ignore browser storage failures.
	}
}

function clearStoredRelayClientAuth() {
	try {
		window.localStorage.removeItem(RELAY_CLIENT_TOKEN_STORAGE_KEY);
	} catch {
		// Ignore browser storage failures.
	}
}

function toBootstrapSession(auth: StoredRelayClientAuth, pairing: RelayPairingStateMessage): RelayBootstrapSession {
	return {
		clientId: auth.clientId,
		token: auth.token,
		expiresAt: auth.expiresAt,
		websocketUrl: auth.websocketUrl,
		pairing,
	};
}

function applyRelayWebSocketOverride(
	session: RelayBootstrapSession,
	relayWebSocketUrl: string | null,
): RelayBootstrapSession {
	if (!relayWebSocketUrl || session.websocketUrl === relayWebSocketUrl) {
		return session;
	}

	return {
		...session,
		websocketUrl: relayWebSocketUrl,
	};
}

function createPendingPairingState(clientId: string): RelayPairingStateMessage {
	return {
		type: "pairing_state",
		status: "pending",
		clientId,
		pairingCode: null,
		agentId: null,
		expiresAt: null,
	};
}

function isRelayBootstrapResponse(value: unknown): value is RelayBootstrapSession {
	if (!isObjectRecord(value)) {
		return false;
	}

	return (
		isObjectRecord(value.pairing) &&
		(value.pairing.status === "pending" || value.pairing.status === "paired") &&
		typeof value.token === "string" &&
		value.token.trim().length > 0 &&
		typeof value.websocketUrl === "string" &&
		value.websocketUrl.trim().length > 0 &&
		typeof value.expiresAt === "number" &&
		normalizeRelayPrincipalId(value.clientId) !== null
	);
}

async function fetchRelayBootstrap(bootstrapUrl: string, clientId: string): Promise<RelayBootstrapSession> {
	const response = await fetch(bootstrapUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({ clientId }),
	});

	if (!response.ok) {
		throw new Error(`relay bootstrap failed with status ${response.status}`);
	}

	const data: unknown = await response.json();
	if (!isRelayBootstrapResponse(data)) {
		throw new Error("relay bootstrap returned an invalid payload");
	}

	return {
		...data,
		clientId: normalizeRelayPrincipalId(data.clientId)!,
		pairing: {
			...data.pairing,
			clientId: normalizeRelayPrincipalId(data.pairing.clientId) ?? data.clientId,
			agentId:
				typeof data.pairing.agentId === "string"
					? normalizeRelayPrincipalId(data.pairing.agentId)
					: null,
		},
	};
}

async function resolveRelayBootstrapSession(
	bootstrapUrl: string,
	relayWebSocketUrl: string | null,
	clientId: string,
	currentPairingState: RelayPairingStateMessage | null,
): Promise<RelayBootstrapSession> {
	const storedAuth = readStoredRelayClientAuth(clientId);
	if (storedAuth && currentPairingState?.status === "paired") {
		return applyRelayWebSocketOverride(
			toBootstrapSession(storedAuth, currentPairingState ?? createPendingPairingState(clientId)),
			relayWebSocketUrl,
		);
	}

	const bootstrap = applyRelayWebSocketOverride(await fetchRelayBootstrap(bootstrapUrl, clientId), relayWebSocketUrl);
	storeRelayClientAuth(bootstrap);
	return bootstrap;
}

function readStoredSessionId(): string | null {
	try {
		return window.sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
	} catch {
		return null;
	}
}

function storeActiveSessionId(sessionId: string | null) {
	try {
		if (sessionId) {
			window.sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
			return;
		}

		window.sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
	} catch {
		// Ignore browser storage failures.
	}
}

function cloneTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
	return transcript.map((entry) => ({
		...entry,
		toolCalls: (entry.toolCalls ?? []).map((toolCall) => ({ ...toolCall })),
		segments: (entry.segments ?? []).map((segment) => ({ ...segment })),
	}));
}

function upsertSessionInList(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
	const next = sessions.filter((entry) => entry.id !== session.id);
	next.push(session);
	next.sort((left, right) => right.updatedAt - left.updatedAt);
	return next;
}

function getSegmentSortValue(segment: TranscriptMessage["segments"][number]): number {
	return segment.contentIndex ?? Number.MAX_SAFE_INTEGER;
}

function insertSegmentInOrder(
	segments: TranscriptMessage["segments"],
	segment: TranscriptMessage["segments"][number],
): TranscriptMessage["segments"] {
	const next = [...segments];
	const insertIndex = next.findIndex((entry) => getSegmentSortValue(entry) > getSegmentSortValue(segment));
	if (insertIndex === -1) {
		next.push(segment);
		return next;
	}

	next.splice(insertIndex, 0, segment);
	return next;
}

function appendAssistantDeltaToMessage(
	message: TranscriptMessage,
	delta: string,
	field: AssistantDeltaField,
	contentIndex: number,
): TranscriptMessage {
	if (field === "thinking") {
		const existingSegmentIndex = message.segments.findIndex(
			(segment) => segment.type === "thinking" && segment.contentIndex === contentIndex,
		);
		const now = Date.now();
		let segments = message.segments;
		if (existingSegmentIndex >= 0) {
			segments = [...message.segments];
			const existingSegment = segments[existingSegmentIndex];
			if (existingSegment?.type === "thinking") {
				segments[existingSegmentIndex] = {
					...existingSegment,
					content: `${existingSegment.content}${delta}`,
					updatedAt: now,
				};
			}
		} else {
			segments = insertSegmentInOrder(message.segments, {
				id: generateId(),
				type: "thinking",
				content: delta,
				contentIndex,
				createdAt: now,
				updatedAt: now,
			});
		}

		return {
			...message,
			pending: true,
			thinking: `${message.thinking ?? ""}${delta}`,
			segments,
		};
	}

	const existingSegmentIndex = message.segments.findIndex(
		(segment) => segment.type === "text" && segment.contentIndex === contentIndex,
	);
	const now = Date.now();
	let segments = message.segments;
	if (existingSegmentIndex >= 0) {
		segments = [...message.segments];
		const existingSegment = segments[existingSegmentIndex];
		if (existingSegment?.type === "text") {
			segments[existingSegmentIndex] = {
				...existingSegment,
				content: `${existingSegment.content}${delta}`,
				updatedAt: now,
			};
		}
	} else {
		segments = insertSegmentInOrder(message.segments, {
			id: generateId(),
			type: "text",
			content: delta,
			contentIndex,
			createdAt: now,
			updatedAt: now,
		});
	}

	return {
		...message,
		pending: true,
		[field]: `${message[field] ?? ""}${delta}`,
		segments,
	};
}

function mergeQueuedAssistantDeltas(deltas: QueuedAssistantDelta[]): QueuedAssistantDelta[] {
	const groupedDeltas = new Map<string, QueuedAssistantDelta>();
	for (const delta of deltas) {
		const key = `${delta.sessionId}:${delta.messageId}:${delta.field}:${delta.contentIndex}`;
		const existingDelta = groupedDeltas.get(key);
		if (existingDelta) {
			existingDelta.delta += delta.delta;
			continue;
		}

		groupedDeltas.set(key, { ...delta });
	}

	return [...groupedDeltas.values()];
}

export function App() {
	const [connected, setConnected] = useState(false);
	const [pendingDraft, setPendingDraft] = useState(false);
	const [tools, setTools] = useState("read, bash, edit, write");
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
	const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStoredSessionId());
	const [pairingState, setPairingState] = useState<RelayPairingStateMessage | null>(null);
	const [relayError, setRelayError] = useState<string | null>(null);

	const socketRef = useRef<WebSocket | null>(null);
	const connectingRef = useRef(false);
	const reconnectTimerRef = useRef<number | null>(null);
	const connectionOwnerHeartbeatRef = useRef<number | null>(null);
	const assistantDeltaFlushTimerRef = useRef<number | null>(null);
	const queuedAssistantDeltasRef = useRef<QueuedAssistantDelta[]>([]);
	const relayBootstrapRef = useRef<RelayBootstrapSession | null>(null);
	const clientIdRef = useRef<string | null>(getOrCreateStoredClientId());
	const connectionOwnerIdRef = useRef<string>(generateId());
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const sessionCacheRef = useRef(sessionCache);
	const activeSessionIdRef = useRef(activeSessionId);
	const pairingStateRef = useRef(pairingState);

	useEffect(() => {
		sessionCacheRef.current = sessionCache;
	}, [sessionCache]);

	useEffect(() => {
		activeSessionIdRef.current = activeSessionId;
	}, [activeSessionId]);

	useEffect(() => {
		pairingStateRef.current = pairingState;
	}, [pairingState]);

	const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
	const activeTranscript = activeSessionId ? sessionCache.get(activeSessionId)?.transcript ?? [] : [];
	const isBusy = pendingDraft || Boolean(activeSession?.busy);
	const pairingReady = pairingState?.status === "paired";

	const focusPrompt = useCallback(() => {
		window.requestAnimationFrame(() => {
			promptInputRef.current?.focus();
		});
	}, []);

	const sendMessage = useCallback((socket: WebSocket, message: ClientMessage) => {
		sendClientMessage(socket, message);
	}, []);

	const flushQueuedAssistantDeltas = useCallback(() => {
		if (assistantDeltaFlushTimerRef.current !== null) {
			window.clearTimeout(assistantDeltaFlushTimerRef.current);
			assistantDeltaFlushTimerRef.current = null;
		}

		if (queuedAssistantDeltasRef.current.length === 0) {
			return;
		}

		const deltas = mergeQueuedAssistantDeltas(queuedAssistantDeltasRef.current);
		queuedAssistantDeltasRef.current = [];

		setSessionCache((previous) => {
			let next = previous;
			for (const delta of deltas) {
				const cached = next.get(delta.sessionId);
				if (!cached) {
					continue;
				}

				const messageIndex = cached.transcript.findIndex((entry) => entry.id === delta.messageId);
				if (messageIndex === -1) {
					continue;
				}
				const existingMessage = cached.transcript[messageIndex];
				if (!existingMessage) {
					continue;
				}

				const updatedMessage = appendAssistantDeltaToMessage(
					existingMessage,
					delta.delta,
					delta.field,
					delta.contentIndex,
				);
				const transcript = [...cached.transcript];
				transcript[messageIndex] = updatedMessage;
				if (next === previous) {
					next = new Map(previous);
				}

				next.set(delta.sessionId, {
					...cached,
					transcript,
				});
			}

			return next;
		});
	}, []);

	const queueAssistantDelta = useCallback(
		(sessionId: string, messageId: string, delta: string, field: AssistantDeltaField, contentIndex: number) => {
			queuedAssistantDeltasRef.current.push({
				sessionId,
				messageId,
				delta,
				field,
				contentIndex,
			});

			if (assistantDeltaFlushTimerRef.current !== null) {
				return;
			}

			assistantDeltaFlushTimerRef.current = window.setTimeout(() => {
				flushQueuedAssistantDeltas();
			}, ASSISTANT_DELTA_BATCH_WINDOW_MS);
		},
		[flushQueuedAssistantDeltas],
	);

	const submitPrompt = useCallback((trimmedPrompt: string) => {
		const socket = socketRef.current;
		if (!trimmedPrompt || !socket || socket.readyState !== WebSocket.OPEN || isBusy || !pairingReady) {
			return false;
		}

		setRelayError(null);
		setPendingDraft(!activeSessionId);
		sendMessage(socket, {
			type: "prompt",
			prompt: trimmedPrompt,
			sessionId: activeSessionId,
		});
		focusPrompt();
		return true;
	}, [activeSessionId, focusPrompt, isBusy, pairingReady, sendMessage]);

	const requestSessionSnapshot = useCallback((sessionId: string | null) => {
		const socket = socketRef.current;
		if (!sessionId || !socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		sendMessage(socket, { type: "load_session", sessionId });
	}, [sendMessage]);

	const activateSession = useCallback((sessionId: string | null, options: { load?: boolean } = {}) => {
		const { load = true } = options;
		activeSessionIdRef.current = sessionId;
		setActiveSessionId(sessionId);
		setPendingDraft(false);
		storeActiveSessionId(sessionId);
		if (load && sessionId) {
			requestSessionSnapshot(sessionId);
		}
		focusPrompt();
	}, [focusPrompt, requestSessionSnapshot]);

	const upsertSessionSnapshot = useCallback((session: SessionSummary, transcript: TranscriptMessage[]) => {
		setSessionCache((previous) => {
			const next = new Map(previous);
			next.set(session.id, {
				session,
				transcript: cloneTranscript(transcript),
			});
			return next;
		});
		setSessions((previous) => upsertSessionInList(previous, session));
	}, []);

	const handleStartNewChat = useCallback(() => {
		activateSession(null, { load: false });
	}, [activateSession]);

	useEffect(() => {
		let disposed = false;

		const scheduleReconnect = () => {
			if (!disposed && reconnectTimerRef.current === null) {
				reconnectTimerRef.current = window.setTimeout(() => {
					void connect();
				}, 1500);
			}
		};

		const stopConnectionOwnerHeartbeat = () => {
			if (connectionOwnerHeartbeatRef.current !== null) {
				window.clearInterval(connectionOwnerHeartbeatRef.current);
				connectionOwnerHeartbeatRef.current = null;
			}
		};

		const startConnectionOwnerHeartbeat = () => {
			stopConnectionOwnerHeartbeat();
			connectionOwnerHeartbeatRef.current = window.setInterval(() => {
				if (!renewRelayConnectionOwnership(connectionOwnerIdRef.current)) {
					socketRef.current?.close(4002, "ownership_lost");
				}
			}, RELAY_CONNECTION_OWNER_HEARTBEAT_MS);
		};

		const notifyDisconnect = () => {
			const socket = socketRef.current;
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				return;
			}

			sendMessage(socket, { type: "disconnect" });
		};

		const connect = async () => {
			const currentSocket = socketRef.current;
			if (
				connectingRef.current ||
				currentSocket?.readyState === WebSocket.CONNECTING ||
				currentSocket?.readyState === WebSocket.OPEN
			) {
				return;
			}

			if (!claimRelayConnectionOwnership(connectionOwnerIdRef.current)) {
				setConnected(false);
				scheduleReconnect();
				return;
			}

			connectingRef.current = true;
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}

			let socket: WebSocket;
			let bootstrap: RelayBootstrapSession;
			try {
				const clientId = clientIdRef.current ?? getOrCreateStoredClientId();
				bootstrap = await resolveRelayBootstrapSession(
					transportConfig.bootstrapUrl,
					transportConfig.relayWebSocketUrl,
					clientId,
					pairingStateRef.current,
				);
				if (disposed) {
					connectingRef.current = false;
					releaseRelayConnectionOwnership(connectionOwnerIdRef.current);
					return;
				}

				clientIdRef.current = bootstrap.clientId;
				storeClientId(bootstrap.clientId);
				storeRelayClientAuth(bootstrap);
				relayBootstrapRef.current = bootstrap;
				setPairingState(bootstrap.pairing);
				socket = new WebSocket(bootstrap.websocketUrl, createRelayProtocols(bootstrap.token));
			} catch (error) {
				connectingRef.current = false;
				releaseRelayConnectionOwnership(connectionOwnerIdRef.current);
				console.error(error);
				scheduleReconnect();
				return;
			}

			connectingRef.current = false;
			socketRef.current = socket;
			startConnectionOwnerHeartbeat();
			let helloSent = false;

			const sendHelloIfNeeded = () => {
				if (helloSent || socket.readyState !== WebSocket.OPEN) {
					return;
				}

				helloSent = true;
				sendMessage(socket, { type: "hello" });
			};

			socket.addEventListener("open", () => {
				if (disposed) {
					socket.close();
					return;
				}

				setConnected(true);
				if (bootstrap.pairing.status === "paired" || pairingStateRef.current?.status === "paired") {
					sendHelloIfNeeded();
				}
			});

			socket.addEventListener("message", (event) => {
				const message = parseIncomingServerMessage(event.data);
				if (!message) {
					console.warn("Ignoring invalid websocket payload");
					return;
				}

				if (message.type !== "assistant_delta" && message.type !== "assistant_thinking_delta") {
					flushQueuedAssistantDeltas();
				}

				switch (message.type) {
					case "connected": {
						setRelayError(null);
						const normalizedClientId = normalizeRelayPrincipalId(message.clientId);
						if (normalizedClientId) {
							clientIdRef.current = normalizedClientId;
							storeClientId(normalizedClientId);
						}
						setTools(message.tools || "read, bash, edit, write");
						break;
					}
					case "pairing_state": {
						setRelayError(null);
						const shouldSendHello = message.status === "paired";
						setPairingState(message);
						if (message.status === "paired") {
							const currentBootstrap = relayBootstrapRef.current;
							if (currentBootstrap) {
								storeRelayClientAuth(currentBootstrap);
							}
						}
						if (shouldSendHello) {
							sendHelloIfNeeded();
						}
						break;
					}
					case "sessions_updated": {
						setSessions(message.sessions);
						setSessionCache((previous) => {
							const next = new Map(previous);
							for (const session of message.sessions) {
								const cached = next.get(session.id);
								next.set(session.id, {
									session,
									transcript: cached?.transcript ?? [],
								});
							}
							return next;
						});

						const currentActiveSessionId = activeSessionIdRef.current;
						if (!currentActiveSessionId) {
							break;
						}

						const nextActiveSession = message.sessions.find((session) => session.id === currentActiveSessionId) ?? null;
						if (!nextActiveSession) {
							activateSession(null, { load: false });
							break;
						}

						const cached = sessionCacheRef.current.get(nextActiveSession.id);
						if (!cached || cached.session.updatedAt < nextActiveSession.updatedAt) {
							requestSessionSnapshot(nextActiveSession.id);
						}
						break;
					}
					case "session_created": {
						setRelayError(null);
						upsertSessionSnapshot(message.session, message.transcript);
						setPendingDraft(false);
						activateSession(message.session.id, { load: false });
						break;
					}
					case "session_snapshot": {
						setRelayError(null);
						upsertSessionSnapshot(message.session, message.transcript);
						break;
					}
					case "assistant_delta": {
						queueAssistantDelta(message.sessionId, message.messageId, message.delta, "body", message.contentIndex);
						break;
					}
					case "assistant_thinking_delta": {
						queueAssistantDelta(
							message.sessionId,
							message.messageId,
							message.delta,
							"thinking",
							message.contentIndex,
						);
						break;
					}
					case "error": {
						setPendingDraft(false);
						setRelayError(message.message);
						console.error(message.message);
						break;
					}
					case "pong": {
						break;
					}
				}
			});

			socket.addEventListener("close", (event) => {
				if (socketRef.current !== socket) {
					return;
				}

				const wasReplaced = event.reason === "replaced" || event.code === RELAY_CLOSE_REPLACED;
				const bootstrap = relayBootstrapRef.current;
				if (event.reason === "unauthorized" || (bootstrap && bootstrap.expiresAt <= Date.now())) {
					clearStoredRelayClientAuth();
				}
				socketRef.current = null;
				relayBootstrapRef.current = null;
				connectingRef.current = false;
				stopConnectionOwnerHeartbeat();
				releaseRelayConnectionOwnership(connectionOwnerIdRef.current);
				setConnected(false);
				setPendingDraft(false);

				if (wasReplaced) {
					setRelayError("Relay connection moved to another tab or window.");
					return;
				}

				scheduleReconnect();
			});

			socket.addEventListener("error", () => {
				setConnected(false);
			});
		};

		window.addEventListener("beforeunload", notifyDisconnect);
		void connect();

		return () => {
			disposed = true;
			window.removeEventListener("beforeunload", notifyDisconnect);
			if (assistantDeltaFlushTimerRef.current !== null) {
				window.clearTimeout(assistantDeltaFlushTimerRef.current);
				assistantDeltaFlushTimerRef.current = null;
			}
			queuedAssistantDeltasRef.current = [];
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
			}
			connectingRef.current = false;
			stopConnectionOwnerHeartbeat();
			notifyDisconnect();
			socketRef.current?.close();
			socketRef.current = null;
			releaseRelayConnectionOwnership(connectionOwnerIdRef.current);
		};
	}, [activateSession, flushQueuedAssistantDeltas, queueAssistantDelta, requestSessionSnapshot, sendMessage, upsertSessionSnapshot]);

	const handleAbort = useCallback(() => {
		const socket = socketRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN || !activeSession || !activeSession.busy) {
			return;
		}

		sendMessage(socket, { type: "abort", sessionId: activeSession.id });
	}, [activeSession, sendMessage]);

	const emptyState = !activeSession
		? {
			title:
				pairingState?.status !== "paired"
					? "Waiting for agent pairing"
					: pendingDraft
						? "Creating session..."
						: "Ready when you are",
			body:
				pairingState?.status !== "paired"
					? pairingState?.pairingCode
						? `Copy pairing code ${pairingState.pairingCode} into your agent server to finish connecting through the relay.`
						: "Waiting for the relay to issue a pairing code."
					: pendingDraft
						? "The server is opening a shared session from your first prompt."
						: "Start with a coding task, file request, or bug report. The first prompt creates a reusable session that stays available in the left rail.",
		}
		: activeTranscript.length === 0
			? {
				title: "Loading session...",
				body: `Fetching the latest transcript from the ${transportConfig.label}.`,
			}
			: null;
	const sessionState = formatSessionState(activeSession, pendingDraft);

	return (
		<main className="grid h-svh w-full overflow-hidden grid-cols-1 font-ui text-ink min-[721px]:grid-cols-[270px_minmax(0,1fr)] min-[1221px]:grid-cols-[320px_minmax(0,1fr)]">
			<Sidebar
				connected={connected}
				pendingDraft={pendingDraft}
				pairingState={pairingState}
				sessions={sessions}
				activeSessionId={activeSessionId}
				sessionState={sessionState}
				onStartNewChat={handleStartNewChat}
				onActivateSession={activateSession}
			/>

			<section className="relative flex h-svh min-w-0 flex-col overflow-hidden">
				<TranscriptPanel
					transcriptRef={transcriptRef}
					activeSession={activeSession}
					activeTranscript={activeTranscript}
					emptyState={emptyState}
					relayError={relayError}
				/>
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4 max-[860px]:px-3">
					<Composer
						connected={connected}
						connectionLabel={transportConfig.label}
						pairingState={pairingState}
						activeSession={activeSession}
						activeSessionId={activeSessionId}
						promptInputRef={promptInputRef}
						onSend={submitPrompt}
						onAbort={handleAbort}
					/>
				</div>
			</section>
		</main>
	);
}
