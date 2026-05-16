import type { LocalWebAdminStatus } from "@apreal/shared";
import type { SessionCacheEntry, SessionSummary, ScheduledJobDetails } from "../chatTypes";
import { JobsPanel } from "./JobsPanel";

type ScheduledJobsPageProps = {
	adminStatus: LocalWebAdminStatus | null;
	jobs: ScheduledJobDetails[];
	jobRuns: SessionSummary[];
	sessionCache: Map<string, SessionCacheEntry>;
	jobsError: string | null;
	jobRunsError: string | null;
	isLoadingJobs: boolean;
	isLoadingJobRuns: boolean;
	connectionError: string | null;
	onBack: () => void;
	onRefreshJobs: () => void;
	onRefreshJobRuns: (jobId: string) => void;
	onUpdateJobInterval: (jobId: string, intervalMinutes: number) => Promise<void>;
	onToggleJobEnabled: (jobId: string, enabled: boolean) => Promise<void>;
	onDeleteJob: (jobId: string) => Promise<void>;
	onEnsureRunLoaded: (runId: string) => void;
};

export function ScheduledJobsPage({
	adminStatus,
	jobs,
	jobRuns,
	sessionCache,
	jobsError,
	jobRunsError,
	isLoadingJobs,
	isLoadingJobRuns,
	connectionError,
	onBack,
	onRefreshJobs,
	onRefreshJobRuns,
	onUpdateJobInterval,
	onToggleJobEnabled,
	onDeleteJob,
	onEnsureRunLoaded,
}: ScheduledJobsPageProps) {
	return (
		<main className="min-h-svh bg-canvas text-ink">
			<div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 py-5 min-[860px]:px-6 min-[1180px]:px-8">
				{/* ---- Header ---- */}
				<header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
					<div>
						<div className="flex items-center gap-3">
							<p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-muted">Job Dashboard</p>
							{jobs.length > 0 ? (
								<span className="inline-flex items-center gap-1.5 border border-line bg-ink-soft px-2.5 py-1 font-mono text-[0.69rem] uppercase tracking-[0.12em] text-muted">
									{jobs.length} job{jobs.length !== 1 ? "s" : ""}
								</span>
							) : null}
						</div>
						<h1 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.03em] leading-tight">Scheduled jobs</h1>
						<p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">
							Manage schedules, inspect run history, and review execution transcripts.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="inline-flex items-center gap-2 border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onRefreshJobs}
						>
							<svg className={`h-4 w-4 ${isLoadingJobs ? "animate-spin" : ""}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M2.5 8a5.5 5.5 0 0 1 10.22-2.17M13.5 8a5.5 5.5 0 0 1-10.22 2.17M8 2.5v2M8 11.5v2" />
							</svg>
							{isLoadingJobs ? "Refreshing..." : "Refresh"}
						</button>
						<button
							type="button"
							className="border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-sidebar-ink transition hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onBack}
						>
							Back to chat
						</button>
					</div>
				</header>

				<JobsPanel
					adminStatus={adminStatus}
					jobs={jobs}
					jobRuns={jobRuns}
					sessionCache={sessionCache}
					jobsError={jobsError}
					jobRunsError={jobRunsError}
					isLoadingJobs={isLoadingJobs}
					isLoadingJobRuns={isLoadingJobRuns}
					connectionError={connectionError}
					onRefreshJobs={onRefreshJobs}
					onRefreshJobRuns={onRefreshJobRuns}
					onUpdateJobInterval={onUpdateJobInterval}
					onToggleJobEnabled={onToggleJobEnabled}
					onDeleteJob={onDeleteJob}
					onEnsureRunLoaded={onEnsureRunLoaded}
				/>
			</div>
		</main>
	);
}
