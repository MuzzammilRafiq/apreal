import type { SessionCacheEntry, SessionSummary, ScheduledJobDetails } from "../chatTypes";
import { JobsPanel } from "./JobsPanel";

type ScheduledJobsPageProps = {
	jobs: ScheduledJobDetails[];
	jobRuns: SessionSummary[];
	sessionCache: Map<string, SessionCacheEntry>;
	jobRunsError: string | null;
	isLoadingJobRuns: boolean;
	connectionError: string | null;
	onBack: () => void;
	onRefreshJobRuns: (jobId: string) => void;
	onUpdateJobInterval: (jobId: string, intervalMinutes: number) => Promise<void>;
	onToggleJobEnabled: (jobId: string, enabled: boolean) => Promise<void>;
	onEnsureRunLoaded: (runId: string) => void;
	selectedJobId?: string | null;
};

export function ScheduledJobsPage({
	jobs,
	jobRuns,
	sessionCache,
	jobRunsError,
	isLoadingJobRuns,
	connectionError,
	onBack,
	onRefreshJobRuns,
	onUpdateJobInterval,
	onToggleJobEnabled,
	onEnsureRunLoaded,
	selectedJobId,
}: ScheduledJobsPageProps) {
	const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;

	return (
		<main className="min-h-svh bg-(--color-canvas) text-[#171717] selection:bg-black/10 selection:text-black">
			<div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-3 py-4 min-[860px]:px-5 min-[860px]:py-6 min-[1180px]:px-6">
				{/* ---- Header ---- */}
				<header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-3">
					<h1 className="min-w-0 truncate text-[1.6rem] font-bold leading-none tracking-tight text-slate-900">
						{selectedJob?.name ?? "Scheduled job"}
					</h1>
					<div className="shrink-0">
						<button
							type="button"
							className="ui-button-primary inline-flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer min-[520px]:w-auto"
							onClick={onBack}
						>
							<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
							</svg>
							Back
						</button>
					</div>
				</header>

				<div className="mt-4">
					<JobsPanel
						jobs={jobs}
						jobRuns={jobRuns}
						sessionCache={sessionCache}
						jobRunsError={jobRunsError}
						isLoadingJobRuns={isLoadingJobRuns}
						connectionError={connectionError}
						onRefreshJobRuns={onRefreshJobRuns}
						onUpdateJobInterval={onUpdateJobInterval}
						onToggleJobEnabled={onToggleJobEnabled}
						onEnsureRunLoaded={onEnsureRunLoaded}
						selectedJobId={selectedJobId}
					/>
				</div>
			</div>
		</main>
	);
}
