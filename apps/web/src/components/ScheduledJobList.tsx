import type { ScheduledJobDetails } from "../chatTypes";

type ScheduledJobListProps = {
	jobs: ScheduledJobDetails[];
	jobsError: string | null;
	isLoadingJobs: boolean;
	selectedJobId?: string | null;
	title?: string;
	onSelectJob: (jobId: string) => void;
};

export function formatInterval(intervalMs: number): string {
	const minutes = Math.round(intervalMs / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = minutes / 60;
	return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function formatNextRunRelative(nextRunAt: number): { label: string; overdue: boolean } {
	const diff = nextRunAt - Date.now();
	const absMs = Math.abs(diff);
	const minutes = Math.round(absMs / 60_000);

	if (absMs < 30_000) return { label: "now", overdue: false };
	if (absMs < 60_000) return { label: "< 1m", overdue: diff < 0 };

	if (minutes < 60) return { label: diff > 0 ? `in ${minutes}m` : `${minutes}m ago`, overdue: diff < 0 };

	const hours = Math.round(minutes / 60);
	if (hours < 48) return { label: diff > 0 ? `in ${hours}h` : `${hours}h ago`, overdue: diff < 0 };

	const days = Math.round(hours / 24);
	return { label: diff > 0 ? `in ${days}d` : `${days}d ago`, overdue: diff < 0 };
}

export function getJobStatusTone(job: ScheduledJobDetails): "active" | "paused" | "error" {
	if (!job.enabled) return "paused";
	if (job.lastError) return "error";
	return "active";
}

type StatusBadgeProps = {
	label: string;
	tone: "active" | "paused" | "error";
};

const STATUS_BADGE_COLORS: Record<StatusBadgeProps["tone"], string> = {
	active: "border-emerald-300 bg-emerald-50 text-emerald-800",
	paused: "border-slate-300 bg-slate-100 text-slate-500",
	error: "border-rose-300 bg-rose-50 text-rose-800",
};

const STATUS_DOT_COLORS: Record<StatusBadgeProps["tone"], string> = {
	active: "bg-emerald-500",
	paused: "bg-slate-400",
	error: "bg-rose-500",
};

function StatusBadge({ label, tone }: StatusBadgeProps) {
	return (
		<span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-widest ${STATUS_BADGE_COLORS[tone]}`}>
			<span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_COLORS[tone]}`} />
			{label}
		</span>
	);
}

export function ScheduledJobList({
	jobs,
	jobsError,
	isLoadingJobs,
	selectedJobId = null,
	title = "Active Recurring Schedules",
	onSelectJob,
}: ScheduledJobListProps) {
	return (
		<section className="flex min-h-0 flex-col overflow-hidden">
			<div className="flex items-center justify-between px-0 py-3">
				<h2 className="text-[0.95rem] font-bold text-slate-950">{title}</h2>
				{jobs.length > 0 ? (
					<span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[0.64rem] font-semibold text-slate-500">
						{jobs.length} active
					</span>
				) : null}
			</div>

			{jobsError ? (
				<div className="mb-3 rounded-md border-l-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-xs font-semibold leading-5 text-rose-800">
					{jobsError}
				</div>
			) : null}

			<div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
				{jobs.length === 0 && !isLoadingJobs ? (
					<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
						<div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<circle cx="12" cy="12" r="9" />
								<path d="M12 7v5l3 2" />
							</svg>
						</div>
						<p className="mt-3 text-[0.9rem] font-bold text-slate-800">No scheduled jobs</p>
						<p className="mx-auto mt-1 max-w-sm text-[0.82rem] font-medium leading-[1.5] text-slate-400">Ask Pi inside chat to create a recurring scheduled job to monitor anything.</p>
					</div>
				) : (
					<div className="space-y-2">
						{jobs.map((job) => {
							const isSelected = job.id === selectedJobId;
							const tone = getJobStatusTone(job);
							const relative = formatNextRunRelative(job.nextRunAt);

							return (
							<button
								key={job.id}
								type="button"
								onClick={() => onSelectJob(job.id)}
							className={`scheduled-job-card group flex w-full cursor-pointer flex-col rounded-lg border px-3 py-2.5 text-left transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ${
								isSelected
									? "border-slate-900 bg-white text-slate-950 ring-1 ring-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.10)]"
									: "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50 hover:shadow-[0_6px_20px_rgba(15,23,42,0.05)]"
							}`}
							>
								<div className="flex w-full items-start justify-between gap-3">
									<p className="min-w-0 flex-1 truncate text-[0.84rem] font-bold text-slate-900">
										{job.name}
									</p>
									{job.enabled
										? <StatusBadge label={relative.overdue ? "Overdue" : "Active"} tone={relative.overdue ? "error" : "active"} />
										: <StatusBadge label="Paused" tone="paused" />}
								</div>
								<p className="mt-1.5 line-clamp-2 text-[0.75rem] font-medium leading-[1.4] text-slate-500">
									{job.prompt}
								</p>
								<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.64rem] font-bold tracking-wider text-slate-400">
									<span className="rounded bg-slate-100 px-1.5 py-0.5 transition-colors group-hover:bg-transparent">
										Interval: {formatInterval(job.intervalMs)}
									</span>
									<span className={relative.overdue && job.enabled ? "text-rose-600" : ""}>
										Next: {relative.label}
									</span>
									<span>{job.runCount} run{job.runCount !== 1 ? "s" : ""}</span>
								</div>
							</button>
							);
						})}
					</div>
				)}
			</div>
		</section>
	);
}
