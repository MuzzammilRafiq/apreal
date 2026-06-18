import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CreateMcpServerRequest, LocalWebAdminStatus, McpServerConfig, ProvidersResponse, UpdateMcpServerRequest } from "@apreal/shared";
import type { ScheduledJobDetails, SessionSummary } from "./chatTypes";
import {
	LOCAL_ADMIN_STATUS_REFRESH_INTERVAL_MS,
	RELAY_STATUS_REFRESH_INTERVAL_MS,
	getErrorMessage,
	isClientStreamRequiredError,
	STREAM_REQUIRED_MESSAGE,
	type AppRoute,
	type ClientMessage,
	type ServerPayload,
} from "./app-state";
import type { WebRuntime } from "./runtime";
import {
	createMcpServer as createMcpServerRequest,
	deleteMcpServer as deleteMcpServerRequest,
	deleteScheduledJob as deleteScheduledJobRequest,
	readMcpServers,
	readProviders,
	readScheduledJobRuns,
	readScheduledJobs,
	refreshMcpServers as refreshMcpServersRequest,
	saveAppendSystemPrompt as saveAppendSystemPromptRequest,
	saveProviderApiKey as saveProviderApiKeyRequest,
	startProviderLogin as startProviderLoginRequest,
	updateDefaultModel as updateDefaultModelRequest,
	updateMcpServer as updateMcpServerRequest,
	updateScheduledJob as updateScheduledJobRequest,
} from "./server-admin";

type UseAppAdminOptions = {
	route: AppRoute;
	runtime: WebRuntime;
	enabled: boolean;
	connected: boolean;
	restartEventStream: () => void;
	setConnected: Dispatch<SetStateAction<boolean>>;
	setStreamRequested: Dispatch<SetStateAction<boolean>>;
};

type RemoteSnapshot = Extract<ServerPayload, {
	type: "providers_snapshot" | "mcp_servers_snapshot" | "jobs_snapshot" | "job_runs_snapshot";
}>;

type PendingRemoteSnapshot = {
	type: RemoteSnapshot["type"];
	matches: (message: RemoteSnapshot) => boolean;
	resolve: (message: RemoteSnapshot) => void;
	reject: (error: Error) => void;
	timer: number;
};

export function useAppAdmin({ route, runtime, enabled, connected, restartEventStream, setConnected, setStreamRequested }: UseAppAdminOptions) {
	const [adminStatus, setAdminStatus] = useState<LocalWebAdminStatus | null>(null);
	const [adminStatusError, setAdminStatusError] = useState<string | null>(null);
	const [transportStatusMessage, setTransportStatusMessage] = useState<string | null>(null);
	const [serverReady, setServerReady] = useState(false);
	const [transportReady, setTransportReady] = useState(false);
	const [authorizedSettingsSections, setAuthorizedSettingsSections] = useState(runtime.capabilities.settingsSections);
	const [providers, setProviders] = useState<ProvidersResponse | null>(null);
	const [providersError, setProvidersError] = useState<string | null>(null);
	const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
	const [mcpServersError, setMcpServersError] = useState<string | null>(null);
	const [loadingMcpServers, setLoadingMcpServers] = useState(false);
	const [scheduledJobs, setScheduledJobs] = useState<ScheduledJobDetails[]>([]);
	const [scheduledJobsError, setScheduledJobsError] = useState<string | null>(null);
	const [loadingScheduledJobs, setLoadingScheduledJobs] = useState(false);
	const [scheduledJobRuns, setScheduledJobRuns] = useState<SessionSummary[]>([]);
	const [scheduledJobRunsError, setScheduledJobRunsError] = useState<string | null>(null);
	const [loadingScheduledJobRuns, setLoadingScheduledJobRuns] = useState(false);
	const [appendPromptMessage, setAppendPromptMessage] = useState<string | null>(null);
	const [appendPromptError, setAppendPromptError] = useState<string | null>(null);
	const [savingAppendPrompt, setSavingAppendPrompt] = useState(false);
	const [providerLoginRedirect, setProviderLoginRedirect] = useState<string | null>(null);
	const connectedRef = useRef(connected);
	const pendingRemoteSnapshotsRef = useRef(new Set<PendingRemoteSnapshot>());

	useEffect(() => {
		connectedRef.current = connected;
	}, [connected]);

	const waitForRemoteStream = useCallback(async (timeoutMs = 8_000) => {
		if (runtime.target !== "remote" || connectedRef.current) {
			return;
		}

		setStreamRequested(true);
		await new Promise<void>((resolve, reject) => {
			const startedAt = Date.now();
			const check = () => {
				if (connectedRef.current) {
					resolve();
					return;
				}

				if (Date.now() - startedAt >= timeoutMs) {
					reject(new Error(STREAM_REQUIRED_MESSAGE));
					return;
				}

				window.setTimeout(check, 50);
			};

			check();
		});
	}, [runtime.target, setStreamRequested]);

	const sendRemoteMessage = useCallback(async (message: ClientMessage) => {
		await waitForRemoteStream();
		try {
			await runtime.transport.sendMessage(message);
		} catch (error) {
			if (!isClientStreamRequiredError(error)) {
				throw error;
			}

			connectedRef.current = false;
			restartEventStream();
			await waitForRemoteStream();
			await runtime.transport.sendMessage(message);
		}
	}, [restartEventStream, runtime, waitForRemoteStream]);

	const requestRemoteSnapshot = useCallback(async <T extends RemoteSnapshot["type"]>(
		message: ClientMessage,
		type: T,
		matches: (snapshot: Extract<RemoteSnapshot, { type: T }>) => boolean = () => true,
	): Promise<Extract<RemoteSnapshot, { type: T }>> => {
		return await new Promise<Extract<RemoteSnapshot, { type: T }>>((resolve, reject) => {
			const pending: PendingRemoteSnapshot = {
				type,
				matches: (snapshot) => snapshot.type === type && matches(snapshot as Extract<RemoteSnapshot, { type: T }>),
				resolve: (snapshot) => resolve(snapshot as Extract<RemoteSnapshot, { type: T }>),
				reject,
				timer: window.setTimeout(() => {
					pendingRemoteSnapshotsRef.current.delete(pending);
					reject(new Error(`Timed out waiting for ${type.replaceAll("_", " ")}.`));
				}, 8_000),
			};
			pendingRemoteSnapshotsRef.current.add(pending);
			void sendRemoteMessage(message).catch((error) => {
				window.clearTimeout(pending.timer);
				pendingRemoteSnapshotsRef.current.delete(pending);
				reject(error);
			});
		});
	}, [sendRemoteMessage]);

	const resolveRemoteSnapshots = useCallback((message: RemoteSnapshot) => {
		for (const pending of pendingRemoteSnapshotsRef.current) {
			if (pending.type !== message.type || !pending.matches(message)) {
				continue;
			}

			window.clearTimeout(pending.timer);
			pendingRemoteSnapshotsRef.current.delete(pending);
			pending.resolve(message);
		}
	}, []);

	useEffect(() => () => {
		for (const pending of pendingRemoteSnapshotsRef.current) {
			window.clearTimeout(pending.timer);
			pending.reject(new Error("Remote snapshot request was cancelled."));
		}
		pendingRemoteSnapshotsRef.current.clear();
	}, []);

	const refreshProviders = useCallback(async () => {
		if (runtime.target === "remote") {
			const snapshot = await requestRemoteSnapshot({ type: "load_providers" }, "providers_snapshot");
			return snapshot;
		}

		try {
			const data = await readProviders();
			setProviders(data);
			setProvidersError(null);
			return data;
		} catch (error) {
			setProvidersError(error instanceof Error ? error.message : "Failed to load providers.");
			throw error;
		}
	}, [requestRemoteSnapshot, runtime.target]);

	const refreshMcpServers = useCallback(async () => {
		setLoadingMcpServers(true);
		try {
			if (runtime.target === "remote") {
				const snapshot = await requestRemoteSnapshot({ type: "load_mcp_servers" }, "mcp_servers_snapshot");
				return snapshot.servers;
			}

			const response = await readMcpServers();
			setMcpServers(response.servers);
			setMcpServersError(null);
			return response.servers;
		} catch (error) {
			setMcpServersError(getErrorMessage(error));
			throw error;
		} finally {
			setLoadingMcpServers(false);
		}
	}, [requestRemoteSnapshot, runtime.target]);

	const reloadMcpServers = useCallback(async () => {
		setLoadingMcpServers(true);
		try {
			if (runtime.target === "remote") {
				const snapshot = await requestRemoteSnapshot({ type: "refresh_mcp_servers" }, "mcp_servers_snapshot");
				return snapshot.servers;
			}

			const response = await refreshMcpServersRequest();
			setMcpServers(response.servers);
			setMcpServersError(null);
			return response.servers;
		} catch (error) {
			setMcpServersError(getErrorMessage(error));
			throw error;
		} finally {
			setLoadingMcpServers(false);
		}
	}, [requestRemoteSnapshot, runtime.target]);

	const refreshAdminStatus = useCallback(async () => {
		const nextStatus = await runtime.transport.readStatus();
		if (nextStatus.adminStatus) {
			setAdminStatus(nextStatus.adminStatus);
			setAdminStatusError(null);
		}
		setTransportStatusMessage(nextStatus.message);
		setServerReady(nextStatus.serverReady);
		setTransportReady(nextStatus.transportReady);
		setAuthorizedSettingsSections(nextStatus.settingsSections);
		if (runtime.target !== "remote" && runtime.capabilities.providers) {
			void refreshProviders().catch(() => {
				// Provider errors are already captured in UI state.
			});
		}
		return nextStatus;
	}, [refreshProviders, runtime, sendRemoteMessage]);

	useEffect(() => {
		if (!enabled) {
			setAdminStatus(null);
			setAdminStatusError(null);
			setTransportStatusMessage(null);
			setServerReady(false);
			setTransportReady(false);
			setAuthorizedSettingsSections(runtime.capabilities.settingsSections);
			setConnected(false);
			setStreamRequested(false);
			return;
		}

		let cancelled = false;
		let refreshTimer: number | null = null;

		const pollAdminStatus = async () => {
			try {
				await refreshAdminStatus();
				if (cancelled) {
					return;
				}

				setStreamRequested(true);
			} catch (error) {
				if (cancelled) {
					return;
				}

				setAdminStatusError(getErrorMessage(error));
				if (runtime.target === "local") {
					setAdminStatus(null);
					setTransportStatusMessage(null);
					setServerReady(false);
					setTransportReady(false);
					setAuthorizedSettingsSections(runtime.capabilities.settingsSections);
					setConnected(false);
				}
			} finally {
				if (!cancelled) {
					const refreshIntervalMs = runtime.target === "remote"
						? RELAY_STATUS_REFRESH_INTERVAL_MS
						: LOCAL_ADMIN_STATUS_REFRESH_INTERVAL_MS;
					refreshTimer = window.setTimeout(pollAdminStatus, refreshIntervalMs);
				}
			}
		};

		void pollAdminStatus();

		return () => {
			cancelled = true;
			if (refreshTimer !== null) {
				window.clearTimeout(refreshTimer);
			}
		};
	}, [enabled, refreshAdminStatus, runtime.capabilities.settingsSections, runtime.target, setConnected, setStreamRequested]);

	const refreshScheduledJobs = useCallback(async () => {
		setLoadingScheduledJobs(true);
		try {
			if (runtime.target === "remote") {
				const snapshot = await requestRemoteSnapshot({ type: "load_jobs" }, "jobs_snapshot");
				return snapshot.jobs;
			}

			const jobs = await readScheduledJobs();
			setScheduledJobs(jobs);
			setScheduledJobsError(null);
			if (jobs.length === 0) {
				setScheduledJobRuns([]);
				setScheduledJobRunsError(null);
			}
			return jobs;
		} catch (error) {
			setScheduledJobsError(getErrorMessage(error));
			throw error;
		} finally {
			setLoadingScheduledJobs(false);
		}
	}, [requestRemoteSnapshot, runtime.target]);

	const refreshScheduledJobRuns = useCallback(async (jobId: string) => {
		setLoadingScheduledJobRuns(true);
		setScheduledJobRuns([]);
		setScheduledJobRunsError(null);
		try {
			if (runtime.target === "remote") {
				const snapshot = await requestRemoteSnapshot(
					{ type: "load_job_runs", jobId },
					"job_runs_snapshot",
					(candidate) => candidate.jobId === jobId,
				);
				return snapshot.runs;
			}

			const runs = await readScheduledJobRuns(jobId);
			setScheduledJobRuns(runs);
			setScheduledJobRunsError(null);
			return runs;
		} catch (error) {
			setScheduledJobRunsError(getErrorMessage(error));
			throw error;
		} finally {
			setLoadingScheduledJobRuns(false);
		}
	}, [requestRemoteSnapshot, runtime.target]);

	const updateScheduledJob = useCallback(async (jobId: string, intervalMinutes: number) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "update_job", jobId, changes: { intervalMinutes } });
			return;
		}

		await updateScheduledJobRequest(jobId, { intervalMinutes });
		await refreshScheduledJobs();
	}, [refreshScheduledJobs, runtime.target, sendRemoteMessage]);

	const toggleScheduledJobEnabled = useCallback(async (jobId: string, enabledValue: boolean) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "update_job", jobId, changes: { enabled: enabledValue } });
			return;
		}

		await updateScheduledJobRequest(jobId, { enabled: enabledValue });
		await refreshScheduledJobs();
	}, [refreshScheduledJobs, runtime.target, sendRemoteMessage]);

	const deleteScheduledJob = useCallback(async (jobId: string) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "delete_job", jobId });
			setScheduledJobRuns([]);
			setScheduledJobRunsError(null);
			return;
		}

		await deleteScheduledJobRequest(jobId);
		setScheduledJobRuns([]);
		setScheduledJobRunsError(null);
		await refreshScheduledJobs();
	}, [refreshScheduledJobs, runtime.target, sendRemoteMessage]);

	const handleRefreshJobs = useCallback(() => {
		void refreshScheduledJobs().catch(() => {
			// The error state is already captured for rendering.
		});
	}, [refreshScheduledJobs]);

	const handleRefreshJobRuns = useCallback((jobId: string) => {
		void refreshScheduledJobRuns(jobId).catch(() => {
			// The error state is already captured for rendering.
		});
	}, [refreshScheduledJobRuns]);

	const handleSaveAppendSystemPrompt = useCallback((appendSystemPrompt: string) => {
		setSavingAppendPrompt(true);
		setAppendPromptError(null);
		setAppendPromptMessage(null);
		if (!runtime.capabilities.systemPrompt) {
			setAppendPromptError("System prompt editing is not available in this web target.");
			setSavingAppendPrompt(false);
			return;
		}

		if (runtime.target === "remote") {
			void sendRemoteMessage({ type: "save_append_system_prompt", appendSystemPrompt })
				.catch((error) => {
					setAppendPromptError(getErrorMessage(error));
					setSavingAppendPrompt(false);
				});
			return;
		}

		void saveAppendSystemPromptRequest(appendSystemPrompt)
			.then((response) => {
				setAdminStatus(response.status);
				setAdminStatusError(null);
				setAppendPromptMessage(
					appendSystemPrompt.trim().length > 0
						? "Appended system prompt saved. Idle sessions will reload it on the next prompt."
						: "Appended system prompt cleared. Idle sessions will use the default prompt on the next prompt.",
				);
			})
			.catch((error) => {
				setAppendPromptError(getErrorMessage(error));
			})
			.finally(() => {
				setSavingAppendPrompt(false);
			});
	}, [runtime, sendRemoteMessage]);

	const handleSetDefaultModel = useCallback(async (provider: string, modelId: string) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "set_default_model", provider, modelId });
			return;
		}

		const nextProviders = await updateDefaultModelRequest({ provider, modelId });
		setProviders(nextProviders);
		setProvidersError(null);
	}, [runtime.target, sendRemoteMessage]);

	const handleStartProviderLogin = useCallback(async (provider: string) => {
		if (runtime.target === "remote") {
			setProviderLoginRedirect(provider);
			await sendRemoteMessage({ type: "start_provider_login", provider });
			return;
		}

		const response = await startProviderLoginRequest(provider);
		setProviders(response);
		setProvidersError(null);

		if (response.loginState.authUrl) {
			window.location.assign(response.loginState.authUrl);
		}
	}, [runtime.target, sendRemoteMessage]);

	const handleSaveProviderApiKey = useCallback(async (provider: string, apiKey: string) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "save_provider_api_key", provider, apiKey });
			return;
		}

		const response = await saveProviderApiKeyRequest(provider, apiKey);
		setProviders(response);
		setProvidersError(null);
	}, [runtime.target, sendRemoteMessage]);

	const handleCreateMcpServer = useCallback(async (requestBody: CreateMcpServerRequest) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "create_mcp_server", request: requestBody });
			return;
		}

		const response = await createMcpServerRequest(requestBody);
		setMcpServers(response.servers);
		setMcpServersError(null);
	}, [runtime.target, sendRemoteMessage]);

	const handleUpdateMcpServer = useCallback(async (serverId: string, requestBody: UpdateMcpServerRequest) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "update_mcp_server", serverId, request: requestBody });
			return;
		}

		const response = await updateMcpServerRequest(serverId, requestBody);
		setMcpServers(response.servers);
		setMcpServersError(null);
	}, [runtime.target, sendRemoteMessage]);

	const handleDeleteMcpServer = useCallback(async (serverId: string) => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "delete_mcp_server", serverId });
			return;
		}

		const response = await deleteMcpServerRequest(serverId);
		setMcpServers(response.servers);
		setMcpServersError(null);
	}, [runtime.target, sendRemoteMessage]);

	const handleServerMessage = useCallback((message: ServerPayload): boolean => {
		switch (message.type) {
			case "status_snapshot": {
				setAdminStatus(message.status);
				setAdminStatusError(null);
				return true;
			}
			case "append_system_prompt_saved": {
				setAdminStatus(message.status);
				setAdminStatusError(null);
				setAppendPromptMessage(
					message.status.appendSystemPrompt.trim().length > 0
						? "Appended system prompt saved. Idle sessions will reload it on the next prompt."
						: "Appended system prompt cleared. Idle sessions will use the default prompt on the next prompt.",
				);
				setSavingAppendPrompt(false);
				setAppendPromptError(null);
				return true;
			}
			case "providers_snapshot": {
				resolveRemoteSnapshots(message);
				setProviders(message);
				setProvidersError(null);
				if (providerLoginRedirect) {
					const activeProvider = message.providers.find((provider) => provider.id === providerLoginRedirect);
					if (activeProvider?.loginState.authUrl) {
						setProviderLoginRedirect(null);
						window.location.assign(activeProvider.loginState.authUrl);
					}
				}
				return true;
			}
			case "mcp_servers_snapshot": {
				resolveRemoteSnapshots(message);
				setMcpServers(message.servers);
				setMcpServersError(null);
				setLoadingMcpServers(false);
				return true;
			}
			case "jobs_snapshot": {
				resolveRemoteSnapshots(message);
				setScheduledJobs(message.jobs);
				setScheduledJobsError(null);
				setLoadingScheduledJobs(false);
				if (message.jobs.length === 0) {
					setScheduledJobRuns([]);
					setScheduledJobRunsError(null);
				}
				return true;
			}
			case "job_runs_snapshot": {
				resolveRemoteSnapshots(message);
				setScheduledJobRuns(message.runs);
				setScheduledJobRunsError(null);
				setLoadingScheduledJobRuns(false);
				return true;
			}
			case "job_updated": {
				setScheduledJobs((current) => {
					const next = current.filter((job) => job.id !== message.job.id);
					next.push(message.job);
					next.sort((left, right) => left.name.localeCompare(right.name));
					return next;
				});
				return true;
			}
			case "job_deleted": {
				setScheduledJobs((current) => current.filter((job) => job.id !== message.jobId));
				setScheduledJobRuns([]);
				setScheduledJobRunsError(null);
				return true;
			}
			default:
				return false;
		}
	}, [providerLoginRedirect, resolveRemoteSnapshots]);

	useEffect(() => {
		if (route !== "jobs" && route !== "settings") {
			return;
		}
		if (!runtime.capabilities.jobs) {
			return;
		}

		void refreshScheduledJobs().catch(() => {
			// The error state is already captured for rendering.
		});
	}, [refreshScheduledJobs, route, runtime.capabilities.jobs]);

	useEffect(() => {
		if (route !== "settings") {
			return;
		}
		if (!runtime.capabilities.mcpServers) {
			return;
		}

		void refreshMcpServers().catch(() => {
			// MCP errors are already captured for rendering.
		});
	}, [refreshMcpServers, route, runtime.capabilities.mcpServers]);

	useEffect(() => {
		if (route === "jobs") {
			return;
		}
		if (!runtime.capabilities.providers) {
			return;
		}

		void refreshProviders().catch(() => {
			// Provider errors are already reflected in state.
		});
	}, [refreshProviders, route, runtime.capabilities.providers]);

	useEffect(() => {
		if (route !== "settings") {
			return;
		}
		if (!runtime.capabilities.providers) {
			return;
		}

		const hasPendingProviderLogin = providers?.providers.some((provider) => provider.loginState.status === "pending");
		if (!hasPendingProviderLogin) {
			return;
		}

		const pollId = window.setInterval(() => {
			void refreshProviders().catch(() => {
				// Provider errors are already reflected in state.
			});
		}, 2000);

		return () => {
			window.clearInterval(pollId);
		};
	}, [providers, refreshProviders, route, runtime.capabilities.providers]);

	return {
		adminStatus, adminStatusError, transportStatusMessage, serverReady, transportReady, authorizedSettingsSections,
		providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
		scheduledJobs, scheduledJobsError, loadingScheduledJobs, scheduledJobRuns, scheduledJobRunsError, loadingScheduledJobRuns,
		appendPromptMessage, appendPromptError, savingAppendPrompt,
		setAdminStatus, setAdminStatusError, refreshAdminStatus, reloadMcpServers, handleRefreshJobs, handleRefreshJobRuns,
		updateScheduledJob, toggleScheduledJobEnabled, deleteScheduledJob, handleSaveAppendSystemPrompt,
		handleSetDefaultModel, handleStartProviderLogin, handleSaveProviderApiKey, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer,
		handleServerMessage,
	};
}
