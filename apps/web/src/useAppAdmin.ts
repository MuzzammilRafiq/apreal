import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { CreateMcpServerRequest, LocalWebAdminStatus, McpServerConfig, ProvidersResponse, UpdateMcpServerRequest } from "@apreal/shared";
import type { ScheduledJobDetails, SessionSummary } from "./chatTypes";
import { ADMIN_STATUS_REFRESH_INTERVAL_MS, getErrorMessage, type AppRoute } from "./app-state";
import type { WebRuntime } from "./runtime";
import {
	deleteScheduledJob as deleteScheduledJobRequest,
	createMcpServer as createMcpServerRequest,
	deleteMcpServer as deleteMcpServerRequest,
	refreshMcpServers as refreshMcpServersRequest,
	readMcpServers,
	readProviders,
	readScheduledJobRuns,
	readScheduledJobs,
	saveProviderApiKey as saveProviderApiKeyRequest,
	saveAppendSystemPrompt as saveAppendSystemPromptRequest,
	startProviderLogin as startProviderLoginRequest,
	updateMcpServer as updateMcpServerRequest,
	updateDefaultModel as updateDefaultModelRequest,
	updateScheduledJob as updateScheduledJobRequest,
} from "./server-admin";

type UseAppAdminOptions = {
	route: AppRoute;
	runtime: WebRuntime;
	setConnected: Dispatch<SetStateAction<boolean>>;
	setStreamRequested: Dispatch<SetStateAction<boolean>>;
};

export function useAppAdmin({ route, runtime, setConnected, setStreamRequested }: UseAppAdminOptions) {
	const [adminStatus, setAdminStatus] = useState<LocalWebAdminStatus | null>(null);
	const [adminStatusError, setAdminStatusError] = useState<string | null>(null);
	const [transportStatusMessage, setTransportStatusMessage] = useState<string | null>(null);
	const [transportReady, setTransportReady] = useState(false);
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
	const refreshProviders = useCallback(async () => {
		try {
			const data = await readProviders();
			setProviders(data);
			setProvidersError(null);
			return data;
		} catch (error) {
			setProvidersError(error instanceof Error ? error.message : "Failed to load providers.");
			throw error;
		}
	}, []);

	const refreshMcpServers = useCallback(async () => {
		setLoadingMcpServers(true);
		try {
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
	}, []);

	const reloadMcpServers = useCallback(async () => {
		setLoadingMcpServers(true);
		try {
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
	}, []);

	const refreshAdminStatus = useCallback(async () => {
		const nextStatus = await runtime.transport.readStatus();
		setAdminStatus(nextStatus.adminStatus);
		setAdminStatusError(null);
		setTransportStatusMessage(nextStatus.message);
		setTransportReady(nextStatus.transportReady);
		if (runtime.capabilities.providers) {
			void refreshProviders().catch(() => {
				// Provider errors are already captured in UI state.
			});
		}
		return nextStatus;
	}, [refreshProviders, runtime]);

	useEffect(() => {
		let cancelled = false;
		let refreshTimer: number | null = null;

		const pollAdminStatus = async () => {
			try {
				const nextStatus = await refreshAdminStatus();
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
	}, [refreshAdminStatus, setConnected, setStreamRequested]);

	const refreshScheduledJobs = useCallback(async () => {
		setLoadingScheduledJobs(true);
		try {
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
	}, []);

	const refreshScheduledJobRuns = useCallback(async (jobId: string) => {
		setLoadingScheduledJobRuns(true);
		setScheduledJobRuns([]);
		setScheduledJobRunsError(null);
		try {
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
	}, []);

	const updateScheduledJob = useCallback(async (jobId: string, intervalMinutes: number) => {
		await updateScheduledJobRequest(jobId, { intervalMinutes });
		await refreshScheduledJobs();
	}, [refreshScheduledJobs]);

	const toggleScheduledJobEnabled = useCallback(async (jobId: string, enabled: boolean) => {
		await updateScheduledJobRequest(jobId, { enabled });
		await refreshScheduledJobs();
	}, [refreshScheduledJobs]);

	const deleteScheduledJob = useCallback(async (jobId: string) => {
		await deleteScheduledJobRequest(jobId);
		setScheduledJobRuns([]);
		setScheduledJobRunsError(null);
		await refreshScheduledJobs();
	}, [refreshScheduledJobs]);


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
	}, [runtime]);

	const handleSetDefaultModel = useCallback(async (provider: string, modelId: string) => {
		const nextProviders = await updateDefaultModelRequest({ provider, modelId });
		setProviders(nextProviders);
		setProvidersError(null);
	}, []);

	const handleStartProviderLogin = useCallback(async (provider: string) => {
		const response = await startProviderLoginRequest(provider);
		setProviders(response);
		setProvidersError(null);

		if (response.loginState.authUrl) {
			window.location.assign(response.loginState.authUrl);
		}
	}, []);

	const handleSaveProviderApiKey = useCallback(async (provider: string, apiKey: string) => {
		const response = await saveProviderApiKeyRequest(provider, apiKey);
		setProviders(response);
		setProvidersError(null);
	}, []);

	const handleCreateMcpServer = useCallback(async (requestBody: CreateMcpServerRequest) => {
		const response = await createMcpServerRequest(requestBody);
		setMcpServers(response.servers);
		setMcpServersError(null);
	}, []);

	const handleUpdateMcpServer = useCallback(async (serverId: string, requestBody: UpdateMcpServerRequest) => {
		const response = await updateMcpServerRequest(serverId, requestBody);
		setMcpServers(response.servers);
		setMcpServersError(null);
	}, []);

	const handleDeleteMcpServer = useCallback(async (serverId: string) => {
		const response = await deleteMcpServerRequest(serverId);
		setMcpServers(response.servers);
		setMcpServersError(null);
	}, []);


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
		adminStatus, adminStatusError, transportStatusMessage, transportReady,
		providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
		scheduledJobs, scheduledJobsError, loadingScheduledJobs, scheduledJobRuns, scheduledJobRunsError, loadingScheduledJobRuns,
		appendPromptMessage, appendPromptError, savingAppendPrompt,
		setAdminStatus, setAdminStatusError, refreshAdminStatus, reloadMcpServers, handleRefreshJobs, handleRefreshJobRuns,
		updateScheduledJob, toggleScheduledJobEnabled, deleteScheduledJob, handleSaveAppendSystemPrompt,
		handleSetDefaultModel, handleStartProviderLogin, handleSaveProviderApiKey, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer,
	};
}
