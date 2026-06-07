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

function renderStatusBadge(label: string, tone: "active" | "paused" | "error") {
	const colors: Record<string, string> = {
		active: "border-slate-300 bg-white text-slate-800",
		paused: "border-slate-300 bg-slate-100 text-slate-500",
		error: "border-slate-400 bg-slate-200 text-slate-800",
	};

	return (
		<span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.64rem] font-bold uppercase tracking-[0.1em] ${colors[tone]}`}>
			{label}
		</span>
	);
}

const ACCENT_BORDER: Record<string, string> = {
	active: "border-l-2 border-l-slate-900",
	paused: "border-l-2 border-l-slate-300",
	error: "border-l-2 border-l-slate-500",
};

export function ScheduledJobList({
	jobs,
	jobsError,
	isLoadingJobs,
	selectedJobId = null,
	title = "Active Recurring Schedules",
	onSelectJob,
}: ScheduledJobListProps) {
	return (
		<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
			<div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
				<h2 className="text-[0.95rem] font-bold text-slate-950">{title}</h2>
				{jobs.length > 0 ? (
					<span className="rounded-sm bg-slate-100 px-2 py-0.5 font-mono text-[0.68rem] font-semibold text-slate-500">
						{jobs.length} Active
					</span>
				) : null}
			</div>

			{jobsError ? (
				<div className="m-3 rounded-md border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs font-semibold leading-5 text-slate-800">
					{jobsError}
				</div>
			) : null}

			<div className="flex-1 overflow-y-auto px-3 py-3.5 scrollbar-thin">
				{jobs.length === 0 && !isLoadingJobs ? (
					<div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm leading-[1.5]">
						<p className="font-bold text-slate-800">No scheduled jobs</p>
						<p className="mt-1 font-medium text-slate-400">Ask Pi inside chat to create a recurring scheduled job to monitor anything.</p>
					</div>
				) : (
					<div className="space-y-2.5">
						{jobs.map((job) => {
							const isSelected = job.id === selectedJobId;
							const tone = getJobStatusTone(job);
							const relative = formatNextRunRelative(job.nextRunAt);

							return (
								<button
									key={job.id}
									type="button"
									onClick={() => onSelectJob(job.id)}
									className={`flex w-full cursor-pointer flex-col rounded-md border p-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 ${ACCENT_BORDER[tone]} ${
										isSelected
											? "border-slate-900 bg-[#171717] text-white"
											: "border-slate-150 bg-[#f8fafc]/60 text-[#0f172a] hover:border-slate-200 hover:bg-slate-50"
									}`}
								>
									<div className="flex w-full items-start justify-between gap-3">
										<p className={`min-w-0 flex-1 truncate text-[0.84rem] font-bold ${isSelected ? "text-white" : "text-slate-900"}`}>
											{job.name}
										</p>
										{job.enabled
											? renderStatusBadge(relative.overdue ? "Overdue" : "Active", relative.overdue ? "error" : "active")
											: renderStatusBadge("Paused", "paused")}
									</div>
									<p className={`mt-2 line-clamp-2 text-[0.76rem] font-medium leading-[1.45] ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
										{job.prompt}
									</p>
									<div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.64rem] font-bold tracking-wider text-slate-400">
										<span className="rounded-sm border border-white/5 bg-white/5 px-1.5 py-0.5">
											Interval: {formatInterval(job.intervalMs)}
										</span>
										<span className={relative.overdue && job.enabled ? "text-slate-200" : ""}>
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
