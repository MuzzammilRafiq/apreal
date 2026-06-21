import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateMcpServerRequest, LocalWebAdminStatus, UpdateMcpServerRequest } from "@apreal/shared";
import type { ScheduledJobDetails } from "./chatTypes";
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
import { ensureLocalBrowserAuthSession } from "./local-auth";
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

const adminQueryKeys = {
	all: (target: WebRuntime["target"]) => ["admin", target] as const,
	providers: (target: WebRuntime["target"]) => [...adminQueryKeys.all(target), "providers"] as const,
	mcpServers: (target: WebRuntime["target"]) => [...adminQueryKeys.all(target), "mcp-servers"] as const,
	scheduledJobs: (target: WebRuntime["target"]) => [...adminQueryKeys.all(target), "scheduled-jobs"] as const,
	scheduledJobRuns: (target: WebRuntime["target"], jobId: string) => [
		...adminQueryKeys.all(target),
		"scheduled-job-runs",
		jobId,
	] as const,
};

function upsertScheduledJob(jobs: ScheduledJobDetails[], job: ScheduledJobDetails): ScheduledJobDetails[] {
	const next = jobs.filter((candidate) => candidate.id !== job.id);
	next.push(job);
	next.sort((left, right) => left.name.localeCompare(right.name));
	return next;
}

export function useAppAdmin({ route, runtime, enabled, connected, restartEventStream, setConnected, setStreamRequested }: UseAppAdminOptions) {
	const queryClient = useQueryClient();
	const [adminStatus, setAdminStatus] = useState<LocalWebAdminStatus | null>(null);
	const [adminStatusError, setAdminStatusError] = useState<string | null>(null);
	const [transportStatusMessage, setTransportStatusMessage] = useState<string | null>(null);
	const [serverReady, setServerReady] = useState(false);
	const [transportReady, setTransportReady] = useState(false);
	const [authorizedSettingsSections, setAuthorizedSettingsSections] = useState(runtime.capabilities.settingsSections);
	const [activeJobRunsId, setActiveJobRunsId] = useState<string | null>(null);
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

	const loadProviders = useCallback(async () => {
		if (runtime.target === "remote") {
			const snapshot = await requestRemoteSnapshot({ type: "load_providers" }, "providers_snapshot");
			return snapshot;
		}

		return await readProviders();
	}, [requestRemoteSnapshot, runtime.target]);

	const loadMcpServers = useCallback(async (refresh = false) => {
		if (runtime.target === "remote") {
			const snapshot = await requestRemoteSnapshot(
				{ type: refresh ? "refresh_mcp_servers" : "load_mcp_servers" },
				"mcp_servers_snapshot",
			);
			return snapshot.servers;
		}

		const response = refresh ? await refreshMcpServersRequest() : await readMcpServers();
		return response.servers;
	}, [requestRemoteSnapshot, runtime.target]);

	const loadScheduledJobs = useCallback(async () => {
		if (runtime.target === "remote") {
			const snapshot = await requestRemoteSnapshot({ type: "load_jobs" }, "jobs_snapshot");
			return snapshot.jobs;
		}

		return await readScheduledJobs();
	}, [requestRemoteSnapshot, runtime.target]);

	const loadScheduledJobRuns = useCallback(async (jobId: string) => {
		if (runtime.target === "remote") {
			const snapshot = await requestRemoteSnapshot(
				{ type: "load_job_runs", jobId },
				"job_runs_snapshot",
				(candidate) => candidate.jobId === jobId,
			);
			return snapshot.runs;
		}

		return await readScheduledJobRuns(jobId);
	}, [requestRemoteSnapshot, runtime.target]);

	const providersQuery = useQuery({
		queryKey: adminQueryKeys.providers(runtime.target),
		queryFn: loadProviders,
		enabled: enabled && runtime.capabilities.providers && route !== "jobs",
		retry: runtime.target === "remote" ? false : 1,
		refetchInterval: (query) => {
			const providers = query.state.data?.providers;
			if (route === "settings" && providers?.some((provider) => provider.loginState.status === "pending")) {
				return 2_000;
			}

			return runtime.target === "local" ? LOCAL_ADMIN_STATUS_REFRESH_INTERVAL_MS : false;
		},
	});
	const mcpServersQuery = useQuery({
		queryKey: adminQueryKeys.mcpServers(runtime.target),
		queryFn: () => loadMcpServers(false),
		enabled: enabled && route === "settings" && runtime.capabilities.mcpServers,
		retry: runtime.target === "remote" ? false : 1,
	});
	const scheduledJobsQuery = useQuery({
		queryKey: adminQueryKeys.scheduledJobs(runtime.target),
		queryFn: loadScheduledJobs,
		enabled: enabled && (route === "jobs" || route === "settings") && runtime.capabilities.jobs,
		retry: runtime.target === "remote" ? false : 1,
	});
	const scheduledJobRunsQuery = useQuery({
		queryKey: adminQueryKeys.scheduledJobRuns(runtime.target, activeJobRunsId ?? "none"),
		queryFn: () => loadScheduledJobRuns(activeJobRunsId!),
		enabled: enabled && route === "jobs" && runtime.capabilities.jobs && activeJobRunsId !== null,
		retry: runtime.target === "remote" ? false : 1,
	});

	const providers = providersQuery.data ?? null;
	const providersError = providersQuery.error ? getErrorMessage(providersQuery.error) : null;
	const mcpServers = mcpServersQuery.data ?? [];
	const mcpServersError = mcpServersQuery.error ? getErrorMessage(mcpServersQuery.error) : null;
	const loadingMcpServers = mcpServersQuery.isFetching;
	const scheduledJobs = scheduledJobsQuery.data ?? [];
	const scheduledJobsError = scheduledJobsQuery.error ? getErrorMessage(scheduledJobsQuery.error) : null;
	const loadingScheduledJobs = scheduledJobsQuery.isFetching;
	const scheduledJobRuns = scheduledJobRunsQuery.data ?? [];
	const scheduledJobRunsError = scheduledJobRunsQuery.error ? getErrorMessage(scheduledJobRunsQuery.error) : null;
	const loadingScheduledJobRuns = scheduledJobRunsQuery.isFetching;

	const reloadMcpServers = useCallback(async () => {
		return await queryClient.fetchQuery({
			queryKey: adminQueryKeys.mcpServers(runtime.target),
			queryFn: () => loadMcpServers(true),
			staleTime: 0,
		});
	}, [loadMcpServers, queryClient, runtime.target]);

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
		return nextStatus;
	}, [runtime]);

	useEffect(() => {
		if (!enabled) {
			queryClient.removeQueries({ queryKey: adminQueryKeys.all(runtime.target) });
			setActiveJobRunsId(null);
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
	}, [enabled, queryClient, refreshAdminStatus, runtime.capabilities.settingsSections, runtime.target, setConnected, setStreamRequested]);

	const updateScheduledJobMutation = useMutation({
		mutationFn: async ({ jobId, changes }: {
			jobId: string;
			changes: { intervalMinutes?: number; enabled?: boolean };
		}) => {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "update_job", jobId, changes });
				return null;
			}

			await ensureLocalBrowserAuthSession();
			return await updateScheduledJobRequest(jobId, changes);
		},
		onSuccess: (job) => {
			if (!job) {
				return;
			}

			queryClient.setQueryData<ScheduledJobDetails[]>(
				adminQueryKeys.scheduledJobs(runtime.target),
				(current = []) => upsertScheduledJob(current, job),
			);
		},
	});
	const deleteScheduledJobMutation = useMutation({
		mutationFn: async (jobId: string) => {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "delete_job", jobId });
				return jobId;
			}

			await ensureLocalBrowserAuthSession();
			await deleteScheduledJobRequest(jobId);
			return jobId;
		},
		onSuccess: (jobId) => {
			queryClient.setQueryData<ScheduledJobDetails[]>(
				adminQueryKeys.scheduledJobs(runtime.target),
				(current = []) => current.filter((job) => job.id !== jobId),
			);
			queryClient.removeQueries({ queryKey: adminQueryKeys.scheduledJobRuns(runtime.target, jobId) });
			setActiveJobRunsId((current) => current === jobId ? null : current);
		},
	});

	const updateScheduledJob = useCallback(async (jobId: string, intervalMinutes: number) => {
		await updateScheduledJobMutation.mutateAsync({ jobId, changes: { intervalMinutes } });
	}, [updateScheduledJobMutation]);

	const toggleScheduledJobEnabled = useCallback(async (jobId: string, enabledValue: boolean) => {
		await updateScheduledJobMutation.mutateAsync({ jobId, changes: { enabled: enabledValue } });
	}, [updateScheduledJobMutation]);

	const deleteScheduledJob = useCallback(async (jobId: string) => {
		await deleteScheduledJobMutation.mutateAsync(jobId);
	}, [deleteScheduledJobMutation]);

	const handleRefreshJobs = useCallback(() => {
		void scheduledJobsQuery.refetch();
	}, [scheduledJobsQuery]);

	const handleRefreshJobRuns = useCallback((jobId: string) => {
		if (activeJobRunsId === jobId) {
			void scheduledJobRunsQuery.refetch();
			return;
		}

		setActiveJobRunsId(jobId);
	}, [activeJobRunsId, scheduledJobRunsQuery]);

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

	const setDefaultModelMutation = useMutation({
		mutationFn: async ({ provider, modelId }: { provider: string; modelId: string }) => {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "set_default_model", provider, modelId });
				return null;
			}

			return await updateDefaultModelRequest({ provider, modelId });
		},
		onSuccess: (response) => {
			if (response) {
				queryClient.setQueryData(adminQueryKeys.providers(runtime.target), response);
			}
		},
	});
	const startProviderLoginMutation = useMutation({
		mutationFn: async (provider: string) => {
			if (runtime.target === "remote") {
				setProviderLoginRedirect(provider);
				await sendRemoteMessage({ type: "start_provider_login", provider });
				return null;
			}

			return await startProviderLoginRequest(provider);
		},
		onSuccess: (response) => {
			if (!response) {
				return;
			}

			queryClient.setQueryData(adminQueryKeys.providers(runtime.target), response);
			if (response.loginState.authUrl) {
				window.location.assign(response.loginState.authUrl);
			}
		},
		onError: () => {
			setProviderLoginRedirect(null);
		},
	});
	const saveProviderApiKeyMutation = useMutation({
		mutationFn: async ({ provider, apiKey }: { provider: string; apiKey: string }) => {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "save_provider_api_key", provider, apiKey });
				return null;
			}

			return await saveProviderApiKeyRequest(provider, apiKey);
		},
		onSuccess: (response) => {
			if (response) {
				queryClient.setQueryData(adminQueryKeys.providers(runtime.target), response);
			}
		},
	});
	const createMcpServerMutation = useMutation({
		mutationFn: async (requestBody: CreateMcpServerRequest) => {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "create_mcp_server", request: requestBody });
				return null;
			}

			return await createMcpServerRequest(requestBody);
		},
		onSuccess: (response) => {
			if (response) {
				queryClient.setQueryData(adminQueryKeys.mcpServers(runtime.target), response.servers);
			}
		},
	});
	const updateMcpServerMutation = useMutation({
		mutationFn: async ({ serverId, requestBody }: { serverId: string; requestBody: UpdateMcpServerRequest }) => {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "update_mcp_server", serverId, request: requestBody });
				return null;
			}

			return await updateMcpServerRequest(serverId, requestBody);
		},
		onSuccess: (response) => {
			if (response) {
				queryClient.setQueryData(adminQueryKeys.mcpServers(runtime.target), response.servers);
			}
		},
	});
	const deleteMcpServerMutation = useMutation({
		mutationFn: async (serverId: string) => {
			if (runtime.target === "remote") {
				await sendRemoteMessage({ type: "delete_mcp_server", serverId });
				return null;
			}

			return await deleteMcpServerRequest(serverId);
		},
		onSuccess: (response) => {
			if (response) {
				queryClient.setQueryData(adminQueryKeys.mcpServers(runtime.target), response.servers);
			}
		},
	});

	const handleSetDefaultModel = useCallback(async (provider: string, modelId: string) => {
		await setDefaultModelMutation.mutateAsync({ provider, modelId });
	}, [setDefaultModelMutation]);
	const handleStartProviderLogin = useCallback(async (provider: string) => {
		await startProviderLoginMutation.mutateAsync(provider);
	}, [startProviderLoginMutation]);
	const handleSaveProviderApiKey = useCallback(async (provider: string, apiKey: string) => {
		await saveProviderApiKeyMutation.mutateAsync({ provider, apiKey });
	}, [saveProviderApiKeyMutation]);
	const handleCreateMcpServer = useCallback(async (requestBody: CreateMcpServerRequest) => {
		await createMcpServerMutation.mutateAsync(requestBody);
	}, [createMcpServerMutation]);
	const handleUpdateMcpServer = useCallback(async (serverId: string, requestBody: UpdateMcpServerRequest) => {
		await updateMcpServerMutation.mutateAsync({ serverId, requestBody });
	}, [updateMcpServerMutation]);
	const handleDeleteMcpServer = useCallback(async (serverId: string) => {
		await deleteMcpServerMutation.mutateAsync(serverId);
	}, [deleteMcpServerMutation]);

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
				queryClient.setQueryData(adminQueryKeys.providers(runtime.target), message);
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
				queryClient.setQueryData(adminQueryKeys.mcpServers(runtime.target), message.servers);
				return true;
			}
			case "jobs_snapshot": {
				resolveRemoteSnapshots(message);
				queryClient.setQueryData(adminQueryKeys.scheduledJobs(runtime.target), message.jobs);
				if (message.jobs.length === 0) {
					queryClient.removeQueries({
						queryKey: [...adminQueryKeys.all(runtime.target), "scheduled-job-runs"],
					});
					setActiveJobRunsId(null);
				}
				return true;
			}
			case "job_runs_snapshot": {
				resolveRemoteSnapshots(message);
				queryClient.setQueryData(
					adminQueryKeys.scheduledJobRuns(runtime.target, message.jobId),
					message.runs,
				);
				return true;
			}
			case "job_updated": {
				queryClient.setQueryData<ScheduledJobDetails[]>(
					adminQueryKeys.scheduledJobs(runtime.target),
					(current = []) => upsertScheduledJob(current, message.job),
				);
				return true;
			}
			case "job_deleted": {
				queryClient.setQueryData<ScheduledJobDetails[]>(
					adminQueryKeys.scheduledJobs(runtime.target),
					(current = []) => current.filter((job) => job.id !== message.jobId),
				);
				queryClient.removeQueries({ queryKey: adminQueryKeys.scheduledJobRuns(runtime.target, message.jobId) });
				setActiveJobRunsId((current) => current === message.jobId ? null : current);
				return true;
			}
			default:
				return false;
		}
	}, [providerLoginRedirect, queryClient, resolveRemoteSnapshots, runtime.target]);

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
