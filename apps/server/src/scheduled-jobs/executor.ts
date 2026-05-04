import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createLogger } from "../logger.ts";
import {
	createAgentController,
	formatModelLabel,
	getErrorMessage,
	type AgentStreamEvent,
} from "../session.ts";
import {
	appendAssistantText,
	appendAssistantThinking,
	appendTranscriptMessage,
	applyAssistantMessageSnapshot,
	buildSessionPayload,
	createPendingAssistantMessage,
	createSharedSession,
	failRunningAssistantToolCalls,
	finalizeAssistantMessage,
	getPendingAssistantMessage,
	settleSession,
	touchSession,
	updateAssistantToolCallStatus,
	upsertAssistantToolCall,
	type SharedSessionState,
} from "../web-session-state.ts";
import type { ClientActions } from "../web-handlers.ts";
import type { ClientConnection } from "../web-utils.ts";
import type { ScheduledJob } from "./types.ts";
import type { JobStore } from "./store.ts";

type ExecutorDeps = {
	store: JobStore;
	sessions: Map<string, SharedSessionState>;
	chatStore: { saveSession(session: SharedSessionState): void };
	clients: Map<string, ClientConnection>;
	cwd: string;
	clientActions: ClientActions;
	logger: ReturnType<typeof createLogger>;
	getCustomTools?: () => ToolDefinition[];
};

function cleanupSessionController(session: SharedSessionState): void {
	session.unsubscribe?.();
	session.unsubscribe = null;
	session.controller?.dispose();
	session.controller = null;
	session.controllerPromise = null;
	if (!session.busy) {
		touchSession(session);
	}
}

function handleControllerEvent(
	session: SharedSessionState,
	event: AgentStreamEvent,
	chatStore: ExecutorDeps["chatStore"],
	clientActions: ClientActions,
) {
	let shouldPersist = false;
	switch (event.type) {
		case "assistant_message_start": {
			if (!getPendingAssistantMessage(session)) {
				createPendingAssistantMessage(session);
				clientActions.broadcastSessionSnapshot(session);
			}
			break;
		}
		case "message_end": {
			applyAssistantMessageSnapshot(session, event);
			finalizeAssistantMessage(session);
			clientActions.broadcastSessionSnapshot(session);
			shouldPersist = true;
			break;
		}
		case "text_delta": {
			const message = appendAssistantText(session, event.delta, event.contentIndex);
			clientActions.broadcast({
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
			clientActions.broadcast({
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
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			shouldPersist = true;
			break;
		}
		case "tool_execution_start": {
			updateAssistantToolCallStatus(session, event.tool.id, event.tool.status);
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			shouldPersist = true;
			break;
		}
		case "tool_execution_end": {
			updateAssistantToolCallStatus(session, event.toolId, event.status);
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			shouldPersist = true;
			break;
		}
		case "done": {
			settleSession(session);
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			shouldPersist = true;
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

			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			shouldPersist = true;
			break;
		}
	}

	if (shouldPersist) {
		chatStore.saveSession(session);
	}
}

export function createJobExecutor(deps: ExecutorDeps) {
	const { store, sessions, chatStore, clients, cwd, clientActions, logger, getCustomTools } = deps;

	return async (job: ScheduledJob): Promise<void> => {
		const session = createSharedSession(job.prompt);
		session.title = `[Scheduled: ${job.name}] ${job.prompt}`;
		session.busy = true;
		sessions.set(session.id, session);

		appendTranscriptMessage(session, {
			id: crypto.randomUUID(),
			role: "system",
			body: `This is a scheduled task: ${job.name}. Run the saved prompt in the background and continue the conversation normally.`,
			thinking: "",
			toolCalls: [],
			segments: [],
			pending: false,
		});
		appendTranscriptMessage(session, {
			id: crypto.randomUUID(),
			role: "user",
			body: job.prompt,
			thinking: "",
			toolCalls: [],
			segments: [],
			pending: false,
		});
		createPendingAssistantMessage(session);
		chatStore.saveSession(session);
		clientActions.broadcast({
			type: "session_created",
			...buildSessionPayload(session),
		});
		clientActions.broadcastSessionSummaryUpdated(session);

		try {
			const controller = await createAgentController(cwd, {
				sessionId: session.id,
				transport: "background",
				customTools: getCustomTools?.(),
			});
			session.controller = controller;
			session.model = formatModelLabel(controller.model);
			session.unsubscribe = controller.subscribe((event) => {
				handleControllerEvent(session, event, chatStore, clientActions);
			});
			touchSession(session);
			clientActions.broadcastSessionSummaryUpdated(session);

			logger.info("starting scheduled job execution", {
				jobId: job.id,
				name: job.name,
				clients: clients.size,
				sessionId: session.id,
			});

			await controller.prompt(job.prompt);
			if (session.busy && !controller.isStreaming()) {
				settleSession(session);
				clientActions.broadcastSessionSnapshot(session);
				clientActions.broadcastSessionSummaryUpdated(session);
			}
			chatStore.saveSession(session);
			store.markJobRun(job.id, Date.now());
		} catch (error) {
			const errorMessage = getErrorMessage(error);
			logger.error("scheduled job prompt failed", {
				jobId: job.id,
				name: job.name,
				sessionId: session.id,
				error: errorMessage,
			});
			settleSession(session);
			appendTranscriptMessage(session, {
				id: crypto.randomUUID(),
				role: "error",
				body: `Error: ${errorMessage}`,
				thinking: "",
				toolCalls: [],
				segments: [],
				pending: false,
			});
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			chatStore.saveSession(session);
			store.markJobRun(job.id, Date.now(), errorMessage);
		} finally {
			cleanupSessionController(session);
			chatStore.saveSession(session);
		}
	};
}