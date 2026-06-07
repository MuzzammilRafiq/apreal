import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CreateMcpServerRequest, LocalWebAdminStatus, McpServerConfig, ProvidersResponse, UpdateMcpServerRequest } from "@apreal/shared";
import type { ScheduledJobDetails, SessionSummary } from "./chatTypes";
import { ADMIN_STATUS_REFRESH_INTERVAL_MS, getErrorMessage, type AppRoute, type ClientMessage, type ServerMessage } from "./app-state";
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
	setConnected: Dispatch<SetStateAction<boolean>>;
	setStreamRequested: Dispatch<SetStateAction<boolean>>;
};

export function useAppAdmin({ route, runtime, enabled, setConnected, setStreamRequested }: UseAppAdminOptions) {
	const [adminStatus, setAdminStatus] = useState<LocalWebAdminStatus | null>(null);
	const [adminStatusError, setAdminStatusError] = useState<string | null>(null);
	const [transportStatusMessage, setTransportStatusMessage] = useState<string | null>(null);
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
	const providersRef = useRef(providers);
	const mcpServersRef = useRef(mcpServers);
	const scheduledJobsRef = useRef(scheduledJobs);
	const scheduledJobRunsRef = useRef(scheduledJobRuns);

	useEffect(() => {
		providersRef.current = providers;
	}, [providers]);

	useEffect(() => {
		mcpServersRef.current = mcpServers;
	}, [mcpServers]);

	useEffect(() => {
		scheduledJobsRef.current = scheduledJobs;
	}, [scheduledJobs]);

	useEffect(() => {
		scheduledJobRunsRef.current = scheduledJobRuns;
	}, [scheduledJobRuns]);

	const sendRemoteMessage = useCallback(async (message: ClientMessage) => {
		setStreamRequested(true);
		try {
			await runtime.transport.sendMessage(message);
		} catch (error) {
			if (getErrorMessage(error) !== "browser client stream is not connected") {
				throw error;
			}

			await new Promise((resolve) => {
				window.setTimeout(resolve, 250);
			});
			await runtime.transport.sendMessage(message);
		}
	}, [runtime, setStreamRequested]);

	const refreshProviders = useCallback(async () => {
		if (runtime.target === "remote") {
			await sendRemoteMessage({ type: "load_providers" });
			return providersRef.current;
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
	}, [runtime.target, sendRemoteMessage]);

	const refreshMcpServers = useCallback(async () => {
		setLoadingMcpServers(true);
		try {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "load_mcp_servers" });
				return mcpServersRef.current;
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
	}, [runtime.target, sendRemoteMessage]);

	const reloadMcpServers = useCallback(async () => {
		setLoadingMcpServers(true);
		try {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "refresh_mcp_servers" });
				return mcpServersRef.current;
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
	}, [runtime.target, sendRemoteMessage]);

	const refreshAdminStatus = useCallback(async () => {
		const nextStatus = await runtime.transport.readStatus();
		setAdminStatus(nextStatus.adminStatus);
		setAdminStatusError(null);
		setTransportStatusMessage(nextStatus.message);
		setTransportReady(nextStatus.transportReady);
		setAuthorizedSettingsSections(nextStatus.settingsSections);
		if (runtime.target === "remote") {
			if (runtime.capabilities.settings) {
				void sendRemoteMessage({ type: "load_status" }).catch(() => {
					// The heartbeat state is already reflected above.
				});
			}
		} else if (runtime.capabilities.providers) {
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

				setAdminStatus(null);
				setAdminStatusError(getErrorMessage(error));
				setTransportStatusMessage(null);
				setTransportReady(false);
				setAuthorizedSettingsSections(runtime.capabilities.settingsSections);
				setConnected(false);
			} finally {
				if (!cancelled) {
					refreshTimer = window.setTimeout(pollAdminStatus, ADMIN_STATUS_REFRESH_INTERVAL_MS);
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
	}, [enabled, refreshAdminStatus, runtime.capabilities.settingsSections, setConnected, setStreamRequested]);

	const refreshScheduledJobs = useCallback(async () => {
		setLoadingScheduledJobs(true);
		try {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "load_jobs" });
				return scheduledJobsRef.current;
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
	}, [runtime.target, sendRemoteMessage]);

	const refreshScheduledJobRuns = useCallback(async (jobId: string) => {
		setLoadingScheduledJobRuns(true);
		setScheduledJobRuns([]);
		setScheduledJobRunsError(null);
		try {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "load_job_runs", jobId });
				return scheduledJobRunsRef.current;
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
	}, [runtime.target, sendRemoteMessage]);

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

	const handleServerMessage = useCallback((message: ServerMessage): boolean => {
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
				setMcpServers(message.servers);
				setMcpServersError(null);
				setLoadingMcpServers(false);
				return true;
			}
			case "jobs_snapshot": {
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
	}, [providerLoginRedirect]);

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
		if (route !== "settings") {
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
		adminStatus, adminStatusError, transportStatusMessage, transportReady, authorizedSettingsSections,
		providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
		scheduledJobs, scheduledJobsError, loadingScheduledJobs, scheduledJobRuns, scheduledJobRunsError, loadingScheduledJobRuns,
		appendPromptMessage, appendPromptError, savingAppendPrompt,
		setAdminStatus, setAdminStatusError, refreshAdminStatus, reloadMcpServers, handleRefreshJobs, handleRefreshJobRuns,
		updateScheduledJob, toggleScheduledJobEnabled, deleteScheduledJob, handleSaveAppendSystemPrompt,
		handleSetDefaultModel, handleStartProviderLogin, handleSaveProviderApiKey, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer,
		handleServerMessage,
	};
}
