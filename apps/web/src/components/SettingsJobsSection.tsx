import type { ScheduledJobDetails } from "../chatTypes";
import { ScheduledJobList } from "./ScheduledJobList";
import { StatusPill } from "./settings-helpers";

type SettingsJobsSectionProps = {
	activeSection: string;
	jobs: ScheduledJobDetails[];
	jobsError: string | null;
	isLoadingJobs: boolean;
	onRefreshJobs: () => void;
	onOpenJob: (jobId: string) => void;
};

export function SettingsJobsSection({
	activeSection,
	jobs,
	jobsError,
	isLoadingJobs,
	onOpenJob,
}: SettingsJobsSectionProps) {
	if (activeSection !== "jobs") {
		return null;
	}

	const enabledJobCount = jobs.filter((job) => job.enabled).length;
	const jobsWithErrorsCount = jobs.filter((job) => job.lastError).length;
	const totalRunCount = jobs.reduce((total, job) => total + job.runCount, 0);

	return (
		<div className="py-3">
			<div className="rounded-lg border border-black/10 bg-white p-3 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
				<div className="flex flex-wrap items-center gap-2">
					<StatusPill
						label={`${enabledJobCount}/${jobs.length} active`}
						tone={enabledJobCount > 0 ? "success" : "neutral"}
					/>
					<StatusPill
						label={`${jobsWithErrorsCount} error${jobsWithErrorsCount !== 1 ? "s" : ""}`}
						tone={jobsWithErrorsCount > 0 ? "danger" : "neutral"}
					/>
					<StatusPill
						label={`${totalRunCount} run${totalRunCount !== 1 ? "s" : ""}`}
						tone={totalRunCount > 0 ? "success" : "neutral"}
					/>
					<span className="ml-auto font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-400">
						{isLoadingJobs ? "Syncing…" : "Live"}
					</span>
				</div>
			</div>

			{jobsError ? (
				<p className="ui-feedback mt-3 rounded px-3 py-2.5 text-[0.82rem] leading-normal font-medium">
					{jobsError}
				</p>
			) : null}

			<section className="mt-4 space-y-3">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">
							Jobs
						</p>
						<h3 className="mt-1 text-[1rem] font-bold text-slate-950">Recurring job list</h3>
						<p className="mt-1 max-w-2xl text-[0.88rem] font-medium leading-[1.55] text-slate-500">
							Browse active recurring schedules here. Open any job to inspect its full configuration, run history, and transcript on the dedicated jobs page.
						</p>
					</div>
				</div>

				<ScheduledJobList
					jobs={jobs}
					jobsError={null}
					isLoadingJobs={isLoadingJobs}
					onSelectJob={onOpenJob}
				/>
			</section>
		</div>
	);
}
