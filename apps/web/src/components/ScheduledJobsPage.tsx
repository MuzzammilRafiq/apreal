import { useEffect, useMemo, useState } from "react";
import type { LocalWebAdminStatus } from "@apreal/shared";
import type { ScheduledJobDetails } from "../chatTypes";

type ScheduledJobsPageProps = {
	adminStatus: LocalWebAdminStatus | null;
	jobs: ScheduledJobDetails[];
	isLoading: boolean;
	error: string | null;
	onBack: () => void;
	onRefresh: () => void;
};

function formatTimestamp(value: number | null): string {
	if (value === null) {
		return "Never";
	}

	return new Date(value).toLocaleString([], {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function formatInterval(intervalMs: number): string {
	const minutes = Math.round(intervalMs / 60_000);
	if (minutes < 60) {
		return `${minutes} min`;
	}

	const hours = minutes / 60;
	if (Number.isInteger(hours)) {
		return `${hours} hr`;
	}

	return `${hours.toFixed(1)} hr`;
}

function renderStatusPill(label: string, tone: "neutral" | "success" | "danger") {
	const toneClassName = tone === "success"
		? "border-accent-line bg-accent-soft text-accent"
		: tone === "danger"
			? "border-danger-line bg-danger-soft text-danger"
			: "border-line bg-ink-soft text-muted";

	return (
		<span className={`inline-flex border px-2.5 py-1 font-mono text-[0.69rem] uppercase tracking-[0.12em] ${toneClassName}`}>
			{label}
		</span>
	);
}

export function ScheduledJobsPage({
	adminStatus,
	jobs,
	isLoading,
	error,
	onBack,
	onRefresh,
}: ScheduledJobsPageProps) {
	const [selectedJobId, setSelectedJobId] = useState<string | null>(jobs[0]?.id ?? null);

	useEffect(() => {
		if (jobs.length === 0) {
			setSelectedJobId(null);
			return;
		}

		if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
			setSelectedJobId(jobs[0]?.id ?? null);
		}
	}, [jobs, selectedJobId]);

	const selectedJob = useMemo(
		() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
		[jobs, selectedJobId],
	);

	return (
		<main className="min-h-svh bg-canvas text-ink">
			<div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-5 py-6 min-[860px]:px-8">
				<header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
					<div>
						<p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-muted">Scheduled jobs</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Recurring background jobs</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
							This compartment shows every persisted scheduled job, including its prompt, timing, run history, and last error.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className="border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onRefresh}
						>
							{isLoading ? "Refreshing jobs..." : "Refresh jobs"}
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

				<div className="grid flex-1 gap-5 py-6 min-[961px]:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.4fr)]">
					<section className="border border-line bg-surface shadow-[0_12px_40px_rgba(23,21,18,0.05)]">
						<div className="border-b border-line px-5 py-5">
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Queue</p>
									<h2 className="mt-2 text-xl font-semibold">All jobs</h2>
								</div>
								{renderStatusPill(`${jobs.length} total`, jobs.length > 0 ? "success" : "neutral")}
							</div>
							{adminStatus ? (
								<p className="mt-3 text-sm leading-6 text-muted">
									Server on port {adminStatus.port} {adminStatus.relayReady ? "is paired" : "is awaiting relay auth"}.
								</p>
							) : null}
						</div>

						{error ? (
							<p className="m-5 border border-danger-line bg-danger-soft px-3 py-3 text-sm leading-6 text-danger">
								{error}
							</p>
						) : null}

						<div className="max-h-[calc(100svh-14rem)] overflow-y-auto px-3 py-3">
							{jobs.length === 0 && !isLoading ? (
								<div className="border border-line bg-surface-strong px-4 py-4 text-sm leading-6 text-muted">
									No scheduled jobs yet. Create one by asking the agent for recurring behavior.
								</div>
							) : (
								jobs.map((job) => {
									const isSelected = job.id === selectedJob?.id;
									return (
										<button
											key={job.id}
											type="button"
											onClick={() => setSelectedJobId(job.id)}
											className={[
												"mb-3 flex w-full flex-col border px-4 py-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
												isSelected
													? "border-ink bg-ink text-sidebar-ink"
													: "border-line bg-surface-strong text-ink hover:border-line-strong hover:bg-white/70",
											].join(" ")}
										>
											<div className="flex items-center justify-between gap-3">
												<p className="min-w-0 flex-1 truncate text-sm font-semibold">{job.name}</p>
												{job.enabled
													? renderStatusPill("Enabled", isSelected ? "neutral" : "success")
													: renderStatusPill("Paused", "danger")}
											</div>
											<p className={`mt-2 line-clamp-2 text-sm leading-6 ${isSelected ? "text-white/72" : "text-muted"}`}>
												{job.prompt}
											</p>
											<p className={`mt-3 font-mono text-[0.72rem] uppercase tracking-[0.12em] ${isSelected ? "text-white/54" : "text-muted"}`}>
												{formatInterval(job.intervalMs)} · next {formatTimestamp(job.nextRunAt)}
											</p>
										</button>
									);
								})
							)}
						</div>
					</section>

					<section className="space-y-5">
						<div className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]">
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Inspector</p>
									<h2 className="mt-2 text-xl font-semibold">Job details</h2>
								</div>
								{selectedJob
									? renderStatusPill(selectedJob.enabled ? "Enabled" : "Paused", selectedJob.enabled ? "success" : "danger")
									: renderStatusPill("No selection", "neutral")}
							</div>

							{selectedJob ? (
								<>
									<dl className="mt-5 grid gap-4 text-sm leading-6 min-[700px]:grid-cols-2">
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Name</dt>
											<dd className="mt-2 text-base font-medium text-ink">{selectedJob.name}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Job id</dt>
											<dd className="mt-2 break-all text-sm text-ink">{selectedJob.id}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Interval</dt>
											<dd className="mt-2 text-base font-medium text-ink">{formatInterval(selectedJob.intervalMs)}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Run count</dt>
											<dd className="mt-2 text-base font-medium text-ink">{selectedJob.runCount}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Next run</dt>
											<dd className="mt-2 text-sm text-ink">{formatTimestamp(selectedJob.nextRunAt)}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Last run</dt>
											<dd className="mt-2 text-sm text-ink">{formatTimestamp(selectedJob.lastRunAt)}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Created</dt>
											<dd className="mt-2 text-sm text-ink">{formatTimestamp(selectedJob.createdAt)}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Updated</dt>
											<dd className="mt-2 text-sm text-ink">{formatTimestamp(selectedJob.updatedAt)}</dd>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4 min-[700px]:col-span-2">
											<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Prompt</dt>
											<dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{selectedJob.prompt}</dd>
										</div>
									</dl>

									<div className="mt-5 border border-line bg-sidebar-bg px-5 py-5 text-sidebar-ink shadow-[0_12px_40px_rgba(23,21,18,0.12)]">
										<div className="flex items-center justify-between gap-3">
											<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-sidebar-muted">Execution guardrails</p>
											<p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-white/54">max catchup {selectedJob.maxCatchup}</p>
										</div>
										<p className="mt-3 text-sm leading-6 text-sidebar-muted">
											Jobs keep their next run in SQLite and are restored when the local server restarts.
										</p>
										{selectedJob.lastError ? (
											<div className="mt-4 border border-danger-line bg-danger-soft px-4 py-4 text-sm leading-6 text-danger">
												<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-danger">Last error</p>
												<p className="mt-2 break-words">{selectedJob.lastError}</p>
											</div>
										) : (
											<div className="mt-4 border border-accent-line bg-accent-soft px-4 py-4 text-sm leading-6 text-accent">
												No execution errors recorded for this job.
											</div>
										)}
									</div>
								</>
							) : (
								<p className="mt-5 border border-line bg-surface-strong px-4 py-4 text-sm leading-6 text-muted">
									Select a scheduled job to inspect it here.
								</p>
							)}
						</div>
					</section>
				</div>
			</div>
		</main>
	);
}