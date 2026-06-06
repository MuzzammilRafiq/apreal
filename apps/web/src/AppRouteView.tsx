import type { RefObject } from "react";
import type { CreateMcpServerRequest, LocalWebAdminStatus, McpServerConfig, ProvidersResponse, UpdateMcpServerRequest } from "@apreal/shared";
import { Composer } from "./components/Composer";
import { ScheduledJobsPage } from "./components/ScheduledJobsPage";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import type { ScheduledJobDetails, SessionCacheEntry, SessionSummary, TranscriptMessage } from "./chatTypes";
import type { AppRoute } from "./app-state";
import type { WebCapabilities } from "./runtime";

type EmptyState = { title: string; body: string } | null;

type AppRouteViewProps = {
	route: AppRoute;
	adminStatus: LocalWebAdminStatus | null;
	adminStatusError: string | null;
	providers: ProvidersResponse | null;
	providersError: string | null;
	mcpServers: McpServerConfig[];
	mcpServersError: string | null;
	loadingMcpServers: boolean;
	savingAppendPrompt: boolean;
	appendPromptMessage: string | null;
	appendPromptError: string | null;
	scheduledJobs: ScheduledJobDetails[];
	scheduledJobRuns: SessionSummary[];
	sessionCache: Map<string, SessionCacheEntry>;
	scheduledJobsError: string | null;
	scheduledJobRunsError: string | null;
	loadingScheduledJobs: boolean;
	loadingScheduledJobRuns: boolean;
	connectionError: string | null;
	pendingDraft: boolean;
	visibleSessions: SessionSummary[];
	loadingMoreSessions: boolean;
	canLoadMoreSessions: boolean;
	activeSessionId: string | null;
	activeSession: SessionSummary | null;
	activeTranscript: TranscriptMessage[];
	emptyState: EmptyState;
	connected: boolean;
	serverReady: boolean;
	streamRequested: boolean;
	capabilities: WebCapabilities;
	connectionLabel: string;
	promptInputRef: RefObject<HTMLTextAreaElement | null>;
	transcriptRef: RefObject<HTMLDivElement | null>;
	onRouteChange: (route: AppRoute) => void;
	onRefreshAdminStatus: () => void;
	onRefreshJobs: () => void;
	onRefreshJobRuns: (jobId: string) => void;
	onUpdateJobInterval: (jobId: string, intervalMinutes: number) => Promise<void>;
	onToggleJobEnabled: (jobId: string, enabled: boolean) => Promise<void>;
	onDeleteJob: (jobId: string) => Promise<void>;
	onEnsureSessionLoaded: (sessionId: string | null) => void;
	onSetDefaultModel: (provider: string, modelId: string) => Promise<void>;
	onStartProviderLogin: (provider: string) => Promise<void>;
	onSaveProviderApiKey: (provider: string, apiKey: string) => Promise<void>;
	onCreateMcpServer: (request: CreateMcpServerRequest) => Promise<void>;
	onUpdateMcpServer: (serverId: string, request: UpdateMcpServerRequest) => Promise<void>;
	onDeleteMcpServer: (serverId: string) => Promise<void>;
	onRefreshMcpServers: () => void;
	onSaveAppendSystemPrompt: (appendSystemPrompt: string) => void;
	onStartNewChat: () => void;
	onActivateSession: (sessionId: string | null) => void;
	onLoadMoreSessions: () => void;
	onSendPrompt: (prompt: string) => boolean;
	onAbort: () => void;
};

export function AppRouteView({
	route, adminStatus, adminStatusError, providers, providersError, mcpServers, mcpServersError, loadingMcpServers,
	savingAppendPrompt, appendPromptMessage, appendPromptError,
	scheduledJobs, scheduledJobRuns, sessionCache, scheduledJobsError, scheduledJobRunsError, loadingScheduledJobs, loadingScheduledJobRuns,
	connectionError, pendingDraft, visibleSessions, loadingMoreSessions, canLoadMoreSessions, activeSessionId, activeSession, activeTranscript,
	emptyState, connected, serverReady, streamRequested, capabilities, connectionLabel, promptInputRef, transcriptRef, onRouteChange, onRefreshAdminStatus,
	onRefreshJobs, onRefreshJobRuns, onUpdateJobInterval, onToggleJobEnabled, onDeleteJob, onEnsureSessionLoaded, onSetDefaultModel,
	onStartProviderLogin, onSaveProviderApiKey, onCreateMcpServer, onUpdateMcpServer, onDeleteMcpServer, onRefreshMcpServers,
	onSaveAppendSystemPrompt, onStartNewChat, onActivateSession, onLoadMoreSessions, onSendPrompt, onAbort,
}: AppRouteViewProps) {
	if (route === "settings" && capabilities.settings) {
		return (
			<SettingsPage
				adminStatus={adminStatus}
				statusError={adminStatusError}
				providers={providers}
				providersError={providersError}
				mcpServers={mcpServers}
				mcpServersError={mcpServersError}
				isLoadingMcpServers={loadingMcpServers}
				isSavingAppendPrompt={savingAppendPrompt}
				appendPromptSubmissionMessage={appendPromptMessage}
				appendPromptSubmissionError={appendPromptError}
				jobs={scheduledJobs}
				jobRuns={scheduledJobRuns}
				sessionCache={sessionCache}
				jobsError={scheduledJobsError}
				jobRunsError={scheduledJobRunsError}
				isLoadingJobs={loadingScheduledJobs}
				isLoadingJobRuns={loadingScheduledJobRuns}
				connectionError={connectionError}
				onBack={() => onRouteChange("chat")}
				onRefresh={() => {
					void onRefreshAdminStatus();
				}}
				onRefreshJobs={onRefreshJobs}
				onRefreshJobRuns={onRefreshJobRuns}
				onUpdateJobInterval={onUpdateJobInterval}
				onToggleJobEnabled={onToggleJobEnabled}
				onDeleteJob={onDeleteJob}
				onEnsureRunLoaded={onEnsureSessionLoaded}
				onSetDefaultModel={onSetDefaultModel}
				onStartProviderLogin={onStartProviderLogin}
				onSaveProviderApiKey={onSaveProviderApiKey}
				onCreateMcpServer={onCreateMcpServer}
				onUpdateMcpServer={onUpdateMcpServer}
				onDeleteMcpServer={onDeleteMcpServer}
				onRefreshMcpServers={() => {
					void onRefreshMcpServers();
				}}
				onSaveAppendSystemPrompt={onSaveAppendSystemPrompt}
			/>
		);
	}

	if (route === "jobs" && capabilities.jobs) {
		return (
			<ScheduledJobsPage
				adminStatus={adminStatus}
				jobs={scheduledJobs}
				jobRuns={scheduledJobRuns}
				sessionCache={sessionCache}
				jobsError={scheduledJobsError}
				jobRunsError={scheduledJobRunsError}
				isLoadingJobs={loadingScheduledJobs}
				isLoadingJobRuns={loadingScheduledJobRuns}
				connectionError={connectionError}
				onBack={() => onRouteChange("chat")}
				onRefreshJobs={onRefreshJobs}
				onRefreshJobRuns={onRefreshJobRuns}
				onUpdateJobInterval={onUpdateJobInterval}
				onToggleJobEnabled={onToggleJobEnabled}
				onDeleteJob={onDeleteJob}
				onEnsureRunLoaded={onEnsureSessionLoaded}
			/>
		);
	}

	return (
		<main className="grid h-svh w-full overflow-hidden grid-cols-1 grid-rows-[auto_minmax(0,1fr)] font-ui text-ink min-[721px]:grid-cols-[240px_minmax(0,1fr)] min-[721px]:grid-rows-1 min-[1221px]:grid-cols-[280px_minmax(0,1fr)]">
			<Sidebar
				pendingDraft={pendingDraft}
				sessions={visibleSessions}
				loadingMoreSessions={loadingMoreSessions}
				canLoadMoreSessions={canLoadMoreSessions}
				activeSessionId={activeSessionId}
				onStartNewChat={onStartNewChat}
				onOpenSettings={capabilities.settings ? () => onRouteChange("settings") : null}
				onActivateSession={(sessionId) => onActivateSession(sessionId)}
				onLoadMoreSessions={onLoadMoreSessions}
			/>

			<section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
				<TranscriptPanel
					transcriptRef={transcriptRef}
					activeSession={activeSession}
					activeTranscript={activeTranscript}
					emptyState={emptyState}
					connectionError={connectionError}
				/>
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 max-[860px]:px-2 max-[860px]:pb-2">
					<Composer
						connected={connected}
						serverReady={serverReady}
						streamRequested={streamRequested}
						connectionLabel={connectionLabel}
						activeSession={activeSession}
						activeSessionId={activeSessionId}
						promptInputRef={promptInputRef}
						onSend={onSendPrompt}
						onAbort={onAbort}
					/>
				</div>
			</section>
		</main>
	);
}
