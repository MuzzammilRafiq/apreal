import {
	RELAY_CLIENT_ID_STORAGE_KEY,
	RELAY_SESSION_ACTION,
	normalizeRelayPrincipalId,
	type RelayPairingStateMessage,
	type RelayClientBootstrapResponse,
} from "@apreal/shared";
import { useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import type { SessionCacheEntry, SessionSummary, TranscriptMessage } from "./chatTypes";
import { formatSessionState } from "./chatView";
import { createRelayProtocols, getWebTransportConfig } from "./transport-config";

const ACTIVE_SESSION_STORAGE_KEY = "pi-browser-active-session";
const transportConfig = getWebTransportConfig();

type RelayBootstrapSession = RelayClientBootstrapResponse;

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

function generateId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createWirePayload(message: ClientMessage): string {
	if (transportConfig.mode === "local") {
		return JSON.stringify(message);
	}

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

	if (transportConfig.mode === "local") {
		return value as ServerMessage;
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

export function App() {
	const [connected, setConnected] = useState(false);
	const [pendingDraft, setPendingDraft] = useState(false);
	const [tools, setTools] = useState("read, bash, edit, write");
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [sessionCache, setSessionCache] = useState<Map<string, SessionCacheEntry>>(() => new Map());
	const [activeSessionId, setActiveSessionId] = useState<string | null>(() => readStoredSessionId());
	const [prompt, setPrompt] = useState("");
	const [pairingState, setPairingState] = useState<RelayPairingStateMessage | null>(null);

	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const relayBootstrapRef = useRef<RelayBootstrapSession | null>(null);
	const clientIdRef = useRef<string | null>(transportConfig.mode === "relay" ? getOrCreateStoredClientId() : null);
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
	const pairingReady = transportConfig.mode !== "relay" || pairingState?.status === "paired";
	const canSend = connected && pairingReady && !isBusy && prompt.trim().length > 0;

	function focusPrompt() {
		window.requestAnimationFrame(() => {
			promptInputRef.current?.focus();
		});
	}

	function sendMessage(socket: WebSocket, message: ClientMessage) {
		sendClientMessage(socket, message);
	}

	function submitPrompt(trimmedPrompt: string) {
		const socket = socketRef.current;
		if (!trimmedPrompt || !socket || socket.readyState !== WebSocket.OPEN || isBusy || !pairingReady) {
			return;
		}

		setPendingDraft(!activeSessionId);
		sendMessage(socket, {
			type: "prompt",
			prompt: trimmedPrompt,
			sessionId: activeSessionId,
		});
		setPrompt("");
		focusPrompt();
	}

	function requestSessionSnapshot(sessionId: string | null) {
		const socket = socketRef.current;
		if (!sessionId || !socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		sendMessage(socket, { type: "load_session", sessionId });
	}

	function activateSession(sessionId: string | null, options: { load?: boolean } = {}) {
		const { load = true } = options;
		activeSessionIdRef.current = sessionId;
		setActiveSessionId(sessionId);
		setPendingDraft(false);
		storeActiveSessionId(sessionId);
		if (load && sessionId) {
			requestSessionSnapshot(sessionId);
		}
		focusPrompt();
	}

	function upsertSessionSnapshot(session: SessionSummary, transcript: TranscriptMessage[]) {
		setSessionCache((previous) => {
			const next = new Map(previous);
			next.set(session.id, {
				session,
				transcript: cloneTranscript(transcript),
			});
			return next;
		});
		setSessions((previous) => upsertSessionInList(previous, session));
	}

	function applyAssistantDelta(
		sessionId: string,
		messageId: string,
		delta: string,
		field: "body" | "thinking",
		contentIndex: number,
	) {
		setSessionCache((previous) => {
			const cached = previous.get(sessionId);
			if (!cached) {
				return previous;
			}

			const transcript = cached.transcript.map((entry) => {
				if (entry.id !== messageId) {
					return entry;
				}

				if (field === "thinking") {
					const existingSegmentIndex = entry.segments.findIndex(
						(segment) => segment.type === "thinking" && segment.contentIndex === contentIndex,
					);
					const now = Date.now();
					let segments = entry.segments;
					if (existingSegmentIndex >= 0) {
						segments = [...entry.segments];
						const existingSegment = segments[existingSegmentIndex];
						if (existingSegment?.type === "thinking") {
							segments[existingSegmentIndex] = {
								...existingSegment,
								content: `${existingSegment.content}${delta}`,
								updatedAt: now,
							};
						}
					} else {
						segments = insertSegmentInOrder(entry.segments, {
							id: generateId(),
							type: "thinking",
							content: delta,
							contentIndex,
							createdAt: now,
							updatedAt: now,
						});
					}

					return {
						...entry,
						pending: true,
						thinking: `${entry.thinking ?? ""}${delta}`,
						segments,
					};
				}

				const existingSegmentIndex = entry.segments.findIndex(
					(segment) => segment.type === "text" && segment.contentIndex === contentIndex,
				);
				const now = Date.now();
				let segments = entry.segments;
				if (existingSegmentIndex >= 0) {
					segments = [...entry.segments];
					const existingSegment = segments[existingSegmentIndex];
					if (existingSegment?.type === "text") {
						segments[existingSegmentIndex] = {
							...existingSegment,
							content: `${existingSegment.content}${delta}`,
							updatedAt: now,
						};
					}
				} else {
					segments = insertSegmentInOrder(entry.segments, {
						id: generateId(),
						type: "text",
						content: delta,
						contentIndex,
						createdAt: now,
						updatedAt: now,
					});
				}

				return {
					...entry,
					pending: true,
					[field]: `${entry[field] ?? ""}${delta}`,
					segments,
				};
			});

			const next = new Map(previous);
			next.set(sessionId, {
				...cached,
				transcript,
			});
			return next;
		});
	}

	useEffect(() => {
		let disposed = false;

		const scheduleReconnect = () => {
			if (!disposed) {
				reconnectTimerRef.current = window.setTimeout(() => {
					void connect();
				}, 1500);
			}
		};

		const notifyDisconnect = () => {
			const socket = socketRef.current;
			if (!socket || socket.readyState !== WebSocket.OPEN) {
				return;
			}

			sendMessage(socket, { type: "disconnect" });
		};

		const connect = async () => {
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}

			let socket: WebSocket;
			try {
				if (transportConfig.mode === "relay") {
					const clientId = clientIdRef.current ?? getOrCreateStoredClientId();
					const bootstrap = await fetchRelayBootstrap(transportConfig.bootstrapUrl, clientId);
					if (disposed) {
						return;
					}

					clientIdRef.current = bootstrap.clientId;
					storeClientId(bootstrap.clientId);
					relayBootstrapRef.current = bootstrap;
					setPairingState(bootstrap.pairing);
					socket = new WebSocket(bootstrap.websocketUrl, createRelayProtocols(bootstrap.token));
				} else {
					socket = new WebSocket(transportConfig.websocketUrl);
				}
			} catch (error) {
				console.error(error);
				scheduleReconnect();
				return;
			}

			socketRef.current = socket;

			socket.addEventListener("open", () => {
				if (disposed) {
					socket.close();
					return;
				}

				setConnected(true);
				sendMessage(socket, { type: "hello" });
			});

			socket.addEventListener("message", (event) => {
				const message = parseIncomingServerMessage(event.data);
				if (!message) {
					console.warn("Ignoring invalid websocket payload");
					return;
				}

					switch (message.type) {
						case "connected": {
						const normalizedClientId = normalizeRelayPrincipalId(message.clientId);
						if (normalizedClientId) {
							clientIdRef.current = normalizedClientId;
							storeClientId(normalizedClientId);
						}
							setTools(message.tools || "read, bash, edit, write");
							break;
						}
						case "pairing_state": {
							const shouldSendHello =
								message.status === "paired" && pairingStateRef.current?.status !== "paired";
							setPairingState(message);
							if (shouldSendHello && socket.readyState === WebSocket.OPEN) {
								sendMessage(socket, { type: "hello" });
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
						upsertSessionSnapshot(message.session, message.transcript);
						setPendingDraft(false);
						activateSession(message.session.id, { load: false });
						break;
					}
					case "session_snapshot": {
						upsertSessionSnapshot(message.session, message.transcript);
						break;
					}
					case "assistant_delta": {
						applyAssistantDelta(message.sessionId, message.messageId, message.delta, "body", message.contentIndex);
						break;
					}
					case "assistant_thinking_delta": {
						applyAssistantDelta(
							message.sessionId,
							message.messageId,
							message.delta,
							"thinking",
							message.contentIndex,
						);
						break;
					}
					case "error": {
						console.error(message.message);
						break;
					}
					case "pong": {
						break;
					}
				}
			});

			socket.addEventListener("close", () => {
				if (socketRef.current === socket) {
					socketRef.current = null;
				}
				relayBootstrapRef.current = null;
				setPairingState(null);
				setConnected(false);
				setPendingDraft(false);

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
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
			}
			notifyDisconnect();
			socketRef.current?.close();
			socketRef.current = null;
		};
	}, []);

	function handleSend() {
		submitPrompt(prompt.trim());
	}

	function handleAbort() {
		const socket = socketRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN || !activeSession || !activeSession.busy) {
			return;
		}

		sendMessage(socket, { type: "abort", sessionId: activeSession.id });
	}

	const emptyState = !activeSession
		? {
			title:
				transportConfig.mode === "relay" && pairingState?.status !== "paired"
					? "Waiting for agent pairing"
					: pendingDraft
						? "Creating session..."
						: "Ready when you are",
			body:
				transportConfig.mode === "relay" && pairingState?.status !== "paired"
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
				onStartNewChat={() => activateSession(null, { load: false })}
				onActivateSession={activateSession}
			/>

			<section className="relative flex h-svh min-w-0 flex-col overflow-hidden">
				<TranscriptPanel transcriptRef={transcriptRef} activeSession={activeSession} activeTranscript={activeTranscript} emptyState={emptyState} />
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4 max-[860px]:px-3">
					<Composer
						connected={connected}
						connectionLabel={transportConfig.label}
						pairingState={pairingState}
						activeSession={activeSession}
						activeSessionId={activeSessionId}
						canSend={canSend}
						prompt={prompt}
						promptInputRef={promptInputRef}
						onPromptChange={setPrompt}
						onSend={handleSend}
						onAbort={handleAbort}
					/>
				</div>
			</section>
		</main>
	);
}
