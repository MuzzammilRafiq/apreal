import type { SessionCacheEntry, SessionSummary, ScheduledJobDetails } from "../chatTypes";
import { JobsPanel } from "./JobsPanel";

type ScheduledJobsPageProps = {
	jobs: ScheduledJobDetails[];
	jobRuns: SessionSummary[];
	sessionCache: Map<string, SessionCacheEntry>;
	jobsError: string | null;
	jobRunsError: string | null;
	isLoadingJobs: boolean;
	isLoadingJobRuns: boolean;
	connectionError: string | null;
	onBack: () => void;
	onSelectJob: (jobId: string) => void;
	onRefreshJobs: () => void;
	onRefreshJobRuns: (jobId: string) => void;
	onUpdateJobInterval: (jobId: string, intervalMinutes: number) => Promise<void>;
	onToggleJobEnabled: (jobId: string, enabled: boolean) => Promise<void>;
	onDeleteJob: (jobId: string) => Promise<void>;
	onEnsureRunLoaded: (runId: string) => void;
	selectedJobId?: string | null;
};

export function ScheduledJobsPage({
	jobs,
	jobRuns,
	sessionCache,
	jobsError,
	jobRunsError,
	isLoadingJobs,
	isLoadingJobRuns,
	connectionError,
	onBack,
	onSelectJob,
	onRefreshJobs,
	onRefreshJobRuns,
	onUpdateJobInterval,
	onToggleJobEnabled,
	onDeleteJob,
	onEnsureRunLoaded,
	selectedJobId,
}: ScheduledJobsPageProps) {
	const refreshIcon = (
		<svg
			className={`h-4 w-4 ${isLoadingJobs ? "animate-spin text-slate-700" : "text-[#525252]"}`}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2.2}
			aria-hidden="true"
		>
			<path d="M21 2v6h-6" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M3 12a9 9 0 0 1 15-6.7L21 8" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M3 22v-6h6" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M21 12a9 9 0 0 1-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);

	return (
		<main className="min-h-svh bg-[linear-gradient(180deg,var(--color-brand-bg)_0%,#fff1f5_40%,#fff8fa_100%)] text-[#171717] selection:bg-[rgba(244,172,183,0.3)] selection:text-[var(--color-brand-ink)]">
			<div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-3 py-4 min-[860px]:px-5 min-[860px]:py-6 min-[1180px]:px-6">
				{/* ---- Header ---- */}
				<header className="flex flex-col gap-3 border-b border-slate-200 pb-3 min-[860px]:flex-row min-[860px]:items-center min-[860px]:justify-between min-[860px]:gap-4">
					<div>
						<div className="flex items-center gap-2.5">
							<p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-[#64748b] font-bold">Job Dashboard</p>
							{jobs.length > 0 ? (
								<span className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.67rem] font-semibold text-slate-700">
									{jobs.length} job{jobs.length !== 1 ? "s" : ""} active
								</span>
							) : null}
						</div>
						<h1 className="mt-1.5 text-[1.6rem] font-bold tracking-tight leading-none text-slate-900">Scheduled automated tasks</h1>
						<p className="mt-2 max-w-xl text-[0.84rem] leading-[1.55] text-[#525252] font-medium">
							Manage recurring background schedules, inspect active run logs, and review deep history execution transcripts.
						</p>
					</div>
					<div className="flex w-full flex-col gap-2.5 shrink-0 min-[520px]:flex-row min-[520px]:items-center min-[860px]:w-auto">
						<button
							type="button"
							className="ui-button-secondary inline-flex w-full items-center justify-center gap-2 rounded-md border px-3.5 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer min-[520px]:w-auto"
							onClick={onRefreshJobs}
						>
							{refreshIcon}
							{isLoadingJobs ? "Syncing..." : "Sync Jobs"}
						</button>
						<button
							type="button"
							className="ui-button-primary inline-flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer min-[520px]:w-auto"
							onClick={onBack}
						>
							<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
							</svg>
							Back to chat
						</button>
					</div>
				</header>

				<div className="mt-4">
					<JobsPanel
						jobs={jobs}
						jobRuns={jobRuns}
						sessionCache={sessionCache}
						jobsError={jobsError}
						jobRunsError={jobRunsError}
						isLoadingJobs={isLoadingJobs}
						isLoadingJobRuns={isLoadingJobRuns}
						connectionError={connectionError}
						onSelectJob={onSelectJob}
						onRefreshJobRuns={onRefreshJobRuns}
						onUpdateJobInterval={onUpdateJobInterval}
						onToggleJobEnabled={onToggleJobEnabled}
						onDeleteJob={onDeleteJob}
						onEnsureRunLoaded={onEnsureRunLoaded}
						selectedJobId={selectedJobId}
					/>
				</div>
			</div>
		</main>
	);
}
