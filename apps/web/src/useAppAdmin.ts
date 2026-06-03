import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { CreateMcpServerRequest, LocalWebAdminStatus, McpServerConfig, ProvidersResponse, UpdateMcpServerRequest } from "@apreal/shared";
import type { ScheduledJobDetails, SessionSummary } from "./chatTypes";
import { ADMIN_STATUS_REFRESH_INTERVAL_MS, getErrorMessage, transportConfig, type AppRoute } from "./app-state";
import {
	deleteScheduledJob as deleteScheduledJobRequest,
	createMcpServer as createMcpServerRequest,
	deleteMcpServer as deleteMcpServerRequest,
	refreshMcpServers as refreshMcpServersRequest,
	readLocalAdminStatus,
	readMcpServers,
	readProviders,
	readScheduledJobRuns,
	readScheduledJobs,
	saveProviderApiKey as saveProviderApiKeyRequest,
	saveAppendSystemPrompt as saveAppendSystemPromptRequest,
	startProviderLogin as startProviderLoginRequest,
	submitRelayReauthentication,
	updateMcpServer as updateMcpServerRequest,
	updateDefaultModel as updateDefaultModelRequest,
	updateScheduledJob as updateScheduledJobRequest,
} from "./server-admin";

type UseAppAdminOptions = {
	route: AppRoute;
	setConnected: Dispatch<SetStateAction<boolean>>;
	setStreamRequested: Dispatch<SetStateAction<boolean>>;
};

export function useAppAdmin({ route, setConnected, setStreamRequested }: UseAppAdminOptions) {
	const [adminStatus, setAdminStatus] = useState<LocalWebAdminStatus | null>(null);
	const [adminStatusError, setAdminStatusError] = useState<string | null>(null);
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
	const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
	const [settingsError, setSettingsError] = useState<string | null>(null);
	const [submittingPairingCode, setSubmittingPairingCode] = useState(false);
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
		const nextStatus = await readLocalAdminStatus(transportConfig.statusUrl);
		setAdminStatus(nextStatus);
		setAdminStatusError(null);
		void refreshProviders().catch(() => {
			// Provider errors are already captured in UI state.
		});
		return nextStatus;
	}, [refreshProviders]);

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
				if (!nextStatus.relayReady) {
					setSettingsMessage(null);
				}
			} catch (error) {
				if (cancelled) {
					return;
				}

				setAdminStatus(null);
				setAdminStatusError(getErrorMessage(error));
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
	}, [refreshAdminStatus]);

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


	const handleSubmitPairingCode = useCallback((pairingCode: string) => {
		const trimmedPairingCode = pairingCode.trim();
		if (!trimmedPairingCode) {
			setSettingsError("A pairing code is required.");
			setSettingsMessage(null);
			return;
		}

		setSubmittingPairingCode(true);
		setSettingsError(null);
		setSettingsMessage(null);
		void submitRelayReauthentication(transportConfig.relayReauthenticateUrl, trimmedPairingCode)
			.then((response) => {
				setAdminStatus(response.status);
				setAdminStatusError(null);
				setSettingsMessage("Relay pairing updated. The server restarted its relay transport.");
			})
			.catch((error) => {
				setSettingsError(getErrorMessage(error));
			})
			.finally(() => {
				setSubmittingPairingCode(false);
			});
	}, []);

	const handleSaveAppendSystemPrompt = useCallback((appendSystemPrompt: string) => {
		setSavingAppendPrompt(true);
		setAppendPromptError(null);
		setAppendPromptMessage(null);
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
	}, []);

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

		void refreshScheduledJobs().catch(() => {
			// The error state is already captured for rendering.
		});
	}, [refreshScheduledJobs, route]);

	useEffect(() => {
		if (route !== "settings") {
			return;
		}

		void refreshMcpServers().catch(() => {
			// MCP errors are already captured for rendering.
		});
	}, [refreshMcpServers, route]);

	useEffect(() => {
		if (route !== "settings") {
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
	}, [providers, refreshProviders, route]);


	return {
		adminStatus, adminStatusError, providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
		scheduledJobs, scheduledJobsError, loadingScheduledJobs, scheduledJobRuns, scheduledJobRunsError, loadingScheduledJobRuns,
		settingsMessage, settingsError, submittingPairingCode, appendPromptMessage, appendPromptError, savingAppendPrompt,
		setAdminStatus, setAdminStatusError, refreshAdminStatus, reloadMcpServers, handleRefreshJobs, handleRefreshJobRuns,
		updateScheduledJob, toggleScheduledJobEnabled, deleteScheduledJob, handleSubmitPairingCode, handleSaveAppendSystemPrompt,
		handleSetDefaultModel, handleStartProviderLogin, handleSaveProviderApiKey, handleCreateMcpServer, handleUpdateMcpServer, handleDeleteMcpServer,
	};
}
