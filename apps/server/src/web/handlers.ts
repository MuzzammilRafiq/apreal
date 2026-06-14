import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	CreateMcpServerRequest,
	LocalWebAdminStatus,
	McpServersResponse,
	ProviderApiKeyResponse,
	ProviderLoginResponse,
	ScheduledJobUpdateRequest,
	UpdateAppendSystemPromptResponse,
	UpdateMcpServerRequest,
} from "@apreal/shared";
import type { ClientAppMessage } from "../protocol.ts";
import {
	buildProvidersPayload,
	createAgentController,
	formatModelLabel,
	getErrorMessage,
	setDefaultProviderModel,
	type AgentStreamEvent,
} from "../session.ts";
import {
	appendAssistantText,
	appendAssistantThinking,
	appendTranscriptMessage,
	applyAssistantMessageSnapshot,
	buildSessionPayload,
	buildSessionSummary,
	createPendingAssistantMessage,
	createSharedSession,
	failRunningAssistantToolCalls,
	finalizeAssistantMessage,
	getPendingAssistantMessage,
	settleSession,
	setAssistantModelInfo,
	touchSession,
	updateAssistantToolCallStatus,
	upsertAssistantToolCall,
	type SharedSessionState,
} from "./session-state.ts";
import type { ClientActions, Logger } from "./client-manager.ts";
import type { ClientConnection } from "./utils.ts";
import { createLogger as createScopedLogger } from "../logger.ts";
import type { JobStore, Scheduler } from "../scheduled-jobs/index.ts";

export { type ClientActions } from "./client-manager.ts";

export interface HandlerState {
	logger: Logger;
	cwd: string;
	clients: Map<string, ClientConnection>;
	sessions: Map<string, SharedSessionState>;
	chatStore: { saveSession(session: SharedSessionState): void; deleteSession?(sessionId: string): void; deleteSessions?(sessionIds: string[]): void };
	getCustomTools?: () => ToolDefinition[];
	jobStore?: JobStore;
	scheduler?: Scheduler;
	buildStatusPayload?: () => Promise<LocalWebAdminStatus>;
	writeAppendSystemPrompt?: (value: string) => Promise<void>;
	recycleIdleSessionControllers?: () => void;
	saveProviderApiKey?: (provider: string, apiKey: string) => Promise<ProviderApiKeyResponse>;
	startProviderLogin?: (provider: string) => Promise<ProviderLoginResponse>;
	readMcpServers?: () => Promise<McpServersResponse>;
	createMcpServer?: (requestBody: CreateMcpServerRequest) => Promise<McpServersResponse>;
	updateMcpServer?: (serverId: string, requestBody: UpdateMcpServerRequest) => Promise<McpServersResponse>;
	deleteMcpServer?: (serverId: string) => Promise<McpServersResponse>;
	refreshMcpServers?: () => Promise<McpServersResponse>;
}

export interface HandlerActions {
	handleClientMessage(clientId: string, message: ClientAppMessage): Promise<void>;
}

export function createHandlers(
	state: HandlerState,
	clientActions: ClientActions,
): HandlerActions {
	const {
		logger, cwd, clients, sessions, chatStore, getCustomTools, jobStore, scheduler,
		buildStatusPayload, writeAppendSystemPrompt, recycleIdleSessionControllers,
		saveProviderApiKey, startProviderLogin,
		readMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, refreshMcpServers,
	} = state;

	function listScheduledJobRuns(jobName: string) {
		const prefix = `[Scheduled: ${jobName}]`;
		return [...sessions.values()]
			.filter((session) => session.title.startsWith(prefix))
			.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
			.map((session) => buildSessionSummary(session));
	}

	function isScheduledSession(session: SharedSessionState): boolean {
		return session.title.startsWith("[Scheduled:");
	}

	function sendJobsSnapshot(clientId: string) {
		if (!jobStore) {
			clientActions.sendError(clientId, "Scheduled jobs are not available on this server.");
			return;
		}

		clientActions.sendClientPayload(clientId, {
			type: "jobs_snapshot",
			jobs: jobStore.listAllJobs(),
		});
	}

	function sendJobRunsSnapshot(clientId: string, jobId: string) {
		if (!jobStore) {
			clientActions.sendError(clientId, "Scheduled jobs are not available on this server.");
			return;
		}

		const job = jobStore.getJob(jobId);
		if (!job) {
			clientActions.sendError(clientId, "Scheduled job not found.");
			return;
		}

		clientActions.sendClientPayload(clientId, {
			type: "job_runs_snapshot",
			jobId: job.id,
			runs: listScheduledJobRuns(job.name),
		});
	}

	function buildProvidersSnapshot() {
		return {
			type: "providers_snapshot" as const,
			...buildProvidersPayload(cwd),
		};
	}

	async function sendStatusSnapshot(clientId: string) {
		if (!buildStatusPayload) {
			clientActions.sendError(clientId, "Server status is not available on this server.");
			return;
		}

		try {
			clientActions.sendClientPayload(clientId, {
				type: "status_snapshot",
				status: await buildStatusPayload(),
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function broadcastStatusSnapshot() {
		if (!buildStatusPayload) {
			return;
		}

		try {
			clientActions.broadcast({
				type: "status_snapshot",
				status: await buildStatusPayload(),
			});
		} catch (error) {
			logger.warn("failed to broadcast status snapshot", { error: getErrorMessage(error) });
		}
	}

	async function sendMcpServersSnapshot(clientId: string) {
		if (!readMcpServers) {
			clientActions.sendError(clientId, "MCP servers are not available on this server.");
			return;
		}

		try {
			clientActions.sendClientPayload(clientId, {
				type: "mcp_servers_snapshot",
				...(await readMcpServers()),
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	function sendProvidersSnapshot(clientId: string) {
		try {
			clientActions.sendClientPayload(clientId, buildProvidersSnapshot());
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	function validateScheduledJobChanges(changes: ScheduledJobUpdateRequest): string | null {
		if (changes.intervalMinutes !== undefined) {
			if (!Number.isFinite(changes.intervalMinutes) || changes.intervalMinutes < 5) {
				return "intervalMinutes must be a number greater than or equal to 5.";
			}
		}

		if (changes.enabled !== undefined && typeof changes.enabled !== "boolean") {
			return "enabled must be a boolean value.";
		}

		return null;
	}

	async function handleUpdateJob(clientId: string, jobId: string, changes: ScheduledJobUpdateRequest) {
		if (!jobStore || !scheduler) {
			clientActions.sendError(clientId, "Scheduled jobs are not available on this server.");
			return;
		}

		const validationError = validateScheduledJobChanges(changes);
		if (validationError) {
			clientActions.sendError(clientId, validationError);
			return;
		}

		const job = jobStore.getJob(jobId);
		if (!job) {
			clientActions.sendError(clientId, "Scheduled job not found.");
			return;
		}

		let updatedJob = job;
		if (changes.intervalMinutes !== undefined) {
			const nextJob = jobStore.updateInterval(job.id, Math.round(changes.intervalMinutes * 60_000));
			if (!nextJob) {
				clientActions.sendError(clientId, "Scheduled job not found.");
				return;
			}
			updatedJob = nextJob;
		}

		if (changes.enabled !== undefined) {
			const nextJob = changes.enabled ? jobStore.resumeJob(job.id) : jobStore.pauseJob(job.id);
			if (!nextJob) {
				clientActions.sendError(clientId, "Scheduled job not found.");
				return;
			}
			updatedJob = nextJob;
		}

		if (updatedJob.enabled) {
			scheduler.scheduleJob(updatedJob);
		} else {
			await scheduler.reschedule(updatedJob.id);
		}

		clientActions.broadcast({
			type: "job_updated",
			job: updatedJob,
		});
	}

	async function handleDeleteJob(clientId: string, jobId: string) {
		if (!jobStore || !scheduler) {
			clientActions.sendError(clientId, "Scheduled jobs are not available on this server.");
			return;
		}

		const job = jobStore.getJob(jobId);
		if (!job) {
			clientActions.sendError(clientId, "Scheduled job not found.");
			return;
		}

		jobStore.deleteJob(job.id);
		await scheduler.reschedule(job.id);
		clientActions.broadcast({
			type: "job_deleted",
			jobId: job.id,
		});
	}

	async function handleSetDefaultModel(clientId: string, provider: string, modelId: string) {
		try {
			const payload = await setDefaultProviderModel(cwd, provider, modelId);
			recycleIdleSessionControllers?.();
			clientActions.broadcast({
				type: "providers_snapshot",
				...payload,
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function handleStartProviderLogin(clientId: string, provider: string) {
		if (!startProviderLogin) {
			clientActions.sendError(clientId, "Provider login is not available on this server.");
			return;
		}

		try {
			const response = await startProviderLogin(provider);
			clientActions.sendClientPayload(clientId, {
				type: "providers_snapshot",
				...response,
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function handleSaveProviderApiKey(clientId: string, provider: string, apiKey: string) {
		if (!saveProviderApiKey) {
			clientActions.sendError(clientId, "Provider API key storage is not available on this server.");
			return;
		}

		try {
			const response = await saveProviderApiKey(provider, apiKey);
			clientActions.broadcast({
				type: "providers_snapshot",
				...response,
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function handleSaveAppendSystemPrompt(clientId: string, appendSystemPrompt: string) {
		if (!writeAppendSystemPrompt || !buildStatusPayload) {
			clientActions.sendError(clientId, "System prompt editing is not available on this server.");
			return;
		}

		try {
			await writeAppendSystemPrompt(appendSystemPrompt);
			recycleIdleSessionControllers?.();
			const response: UpdateAppendSystemPromptResponse = {
				status: await buildStatusPayload(),
			};
			clientActions.broadcast({
				type: "append_system_prompt_saved",
				status: response.status,
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function handleCreateMcpServer(clientId: string, request: CreateMcpServerRequest) {
		if (!createMcpServer) {
			clientActions.sendError(clientId, "MCP servers are not available on this server.");
			return;
		}

		try {
			clientActions.broadcast({
				type: "mcp_servers_snapshot",
				...(await createMcpServer(request)),
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function handleUpdateMcpServer(clientId: string, serverId: string, request: UpdateMcpServerRequest) {
		if (!updateMcpServer) {
			clientActions.sendError(clientId, "MCP servers are not available on this server.");
			return;
		}

		try {
			clientActions.broadcast({
				type: "mcp_servers_snapshot",
				...(await updateMcpServer(serverId, request)),
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function handleDeleteMcpServer(clientId: string, serverId: string) {
		if (!deleteMcpServer) {
			clientActions.sendError(clientId, "MCP servers are not available on this server.");
			return;
		}

		try {
			clientActions.broadcast({
				type: "mcp_servers_snapshot",
				...(await deleteMcpServer(serverId)),
			});
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	async function handleRefreshMcpServers(clientId: string) {
		if (!refreshMcpServers) {
			clientActions.sendError(clientId, "MCP servers are not available on this server.");
			return;
		}

		try {
			clientActions.broadcast({
				type: "mcp_servers_snapshot",
				...(await refreshMcpServers()),
			});
			await broadcastStatusSnapshot();
		} catch (error) {
			clientActions.sendError(clientId, getErrorMessage(error));
		}
	}

	function handleControllerEvent(session: SharedSessionState, event: AgentStreamEvent) {
		let shouldPersist = false;
		switch (event.type) {
			case "assistant_message_start": {
				if (!getPendingAssistantMessage(session)) {
					createPendingAssistantMessage(session);
					clientActions.broadcastSessionSnapshot(session);
					clientActions.broadcastSessionSummaryUpdated(session);
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
				clientActions.broadcastSessionPayload(session.id, {
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
				clientActions.broadcastSessionPayload(session.id, {
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

	async function ensureController(session: SharedSessionState) {
		const sessionLogger = createScopedLogger(`web-session:${session.id}`);
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
				transport: "http",
				customTools: getCustomTools?.(),
			});
			session.controller = controller;
			session.model = formatModelLabel(controller.model);
			setAssistantModelInfo(session, controller.modelInfo.modelLabel, controller.modelInfo.modelSource);
			session.unsubscribe = controller.subscribe((event) => {
				handleControllerEvent(session, event);
			});
			touchSession(session);
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
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
			clientActions.sendError(clientId, "Prompt cannot be empty.");
			return;
		}

		let session = sessionId ? sessions.get(sessionId) : null;
		const createdSession = !session;
		if (sessionId && !session) {
			clientActions.sendError(clientId, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session) {
			session = createSharedSession(trimmedPrompt);
			sessions.set(session.id, session);
		}

		if (session.busy) {
			clientActions.sendError(
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
		clientActions.markSessionLoaded(clientId, session.id);
		if (createdSession) {
			chatStore.saveSession(session);
		}

		if (createdSession) {
			clientActions.sendClientPayload(clientId, {
				type: "session_created",
				...buildSessionPayload(session),
			}, { requireReady: false });
		} else {
			clientActions.broadcastSessionSnapshot(session);
		}
		clientActions.broadcastSessionSummaryUpdated(session);

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
				clientActions.broadcastSessionSnapshot(session);
				clientActions.broadcastSessionSummaryUpdated(session);
			}
			chatStore.saveSession(session);
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
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			chatStore.saveSession(session);
			clientActions.sendError(clientId, getErrorMessage(error), session.id);
		}
	}

	async function handleAbort(clientId: string, sessionId: string) {
		const session = sessions.get(sessionId);
		if (!session) {
			clientActions.sendError(clientId, "The selected session could not be found.", sessionId);
			return;
		}

		if (!session.busy) {
			clientActions.sendSessionSnapshot(clientId, session);
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
			clientActions.sendError(clientId, getErrorMessage(error), sessionId);
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
			clientActions.broadcastSessionSnapshot(session);
			clientActions.broadcastSessionSummaryUpdated(session);
			chatStore.saveSession(session);
		}
	}

	async function handleDeleteSession(clientId: string, sessionId: string) {
		const session = sessions.get(sessionId);
		if (!session) {
			chatStore.deleteSession?.(sessionId);
			clientActions.sendClientPayload(
				clientId,
				{ type: "session_deleted", sessionId },
				{ requireReady: false },
			);
			return;
		}

		if (session.busy) {
			clientActions.sendError(
				clientId,
				"The selected session is still responding. Wait for it to finish or abort the current run.",
				sessionId,
			);
			return;
		}

		session.abortRequested = true;
		session.unsubscribe?.();
		session.unsubscribe = null;
		session.controller = null;
		session.controllerPromise = null;
		sessions.delete(sessionId);
		chatStore.deleteSession?.(sessionId);
		clientActions.broadcast({ type: "session_deleted", sessionId });
	}

	async function handleDeleteAllSessions(clientId: string) {
		const deletableSessions = [...sessions.values()].filter((session) => !isScheduledSession(session));
		const busySession = deletableSessions.find((session) => session.busy);
		if (busySession) {
			clientActions.sendError(
				clientId,
				"One or more chats are still responding. Wait for them to finish or abort them before deleting all chats.",
				busySession.id,
			);
			return;
		}

		const sessionIds = deletableSessions.map((session) => session.id);
		for (const session of deletableSessions) {
			session.abortRequested = true;
			session.unsubscribe?.();
			session.unsubscribe = null;
			session.controller?.dispose();
			session.controller = null;
			session.controllerPromise = null;
			sessions.delete(session.id);
		}

		if (chatStore.deleteSessions) {
			chatStore.deleteSessions(sessionIds);
		} else {
			for (const sessionId of sessionIds) {
				chatStore.deleteSession?.(sessionId);
			}
		}

		for (const sessionId of sessionIds) {
			clientActions.broadcast({ type: "session_deleted", sessionId });
		}
	}

	async function handleClientMessage(clientId: string, message: ClientAppMessage) {
		const client = clients.get(clientId);
		if (!client || client.closed) {
			logger.warn("message received for missing client", { clientId, type: message.type });
			return;
		}

		if (!client.ready) {
			clientActions.sendError(clientId, "Client must send hello before other messages.");
			return;
		}

		if (message.type === "load_sessions_page") {
			clientActions.sendSessionPage(clientId, message.offset, message.limit);
			return;
		}

		if (message.type === "prompt") {
			await handlePrompt(clientId, message.prompt, message.sessionId);
			return;
		}

		if (message.type === "abort") {
			await handleAbort(clientId, message.sessionId);
			return;
		}

		if (message.type === "delete_session") {
			await handleDeleteSession(clientId, message.sessionId);
			return;
		}

		if (message.type === "delete_all_sessions") {
			await handleDeleteAllSessions(clientId);
			return;
		}

		if (message.type === "load_session") {
			const session = sessions.get(message.sessionId);
			if (!session) {
				clientActions.sendError(clientId, "The selected session could not be found.", message.sessionId);
				return;
			}

			clientActions.markSessionLoaded(clientId, session.id);
			if (message.knownRevision !== undefined && message.knownRevision >= session.revision) {
				return;
			}

			clientActions.sendSessionSnapshot(clientId, session);
			return;
		}

		if (message.type === "load_jobs") {
			sendJobsSnapshot(clientId);
			return;
		}

		if (message.type === "load_providers") {
			sendProvidersSnapshot(clientId);
			return;
		}

		if (message.type === "load_status") {
			await sendStatusSnapshot(clientId);
			return;
		}

		if (message.type === "load_mcp_servers") {
			await sendMcpServersSnapshot(clientId);
			return;
		}

		if (message.type === "load_job_runs") {
			sendJobRunsSnapshot(clientId, message.jobId);
			return;
		}

		if (message.type === "set_default_model") {
			await handleSetDefaultModel(clientId, message.provider, message.modelId);
			return;
		}

		if (message.type === "start_provider_login") {
			await handleStartProviderLogin(clientId, message.provider);
			return;
		}

		if (message.type === "save_provider_api_key") {
			await handleSaveProviderApiKey(clientId, message.provider, message.apiKey);
			return;
		}

		if (message.type === "update_job") {
			await handleUpdateJob(clientId, message.jobId, message.changes);
			return;
		}

		if (message.type === "delete_job") {
			await handleDeleteJob(clientId, message.jobId);
			return;
		}

		if (message.type === "save_append_system_prompt") {
			await handleSaveAppendSystemPrompt(clientId, message.appendSystemPrompt);
			return;
		}

		if (message.type === "create_mcp_server") {
			await handleCreateMcpServer(clientId, message.request);
			return;
		}

		if (message.type === "update_mcp_server") {
			await handleUpdateMcpServer(clientId, message.serverId, message.request);
			return;
		}

		if (message.type === "delete_mcp_server") {
			await handleDeleteMcpServer(clientId, message.serverId);
			return;
		}

		if (message.type === "refresh_mcp_servers") {
			await handleRefreshMcpServers(clientId);
			return;
		}

		if (message.type === "ping") {
			clientActions.sendClientPayload(clientId, { type: "pong" }, { requireReady: false });
			return;
		}
	}

	return {
		handleClientMessage,
	};
}
