import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalWebAdminStatus } from "@apreal/shared";
import type { SessionCacheEntry, SessionSummary, ScheduledJobDetails } from "../chatTypes";
import { TranscriptPanel } from "./TranscriptPanel";

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

function formatTimestamp(value: number | null): string {
	if (value === null) return "Never";
	return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatInterval(intervalMs: number): string {
	const minutes = Math.round(intervalMs / 60_000);
	if (minutes < 60) return `${minutes} min`;
	const hours = minutes / 60;
	return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

function formatNextRunRelative(nextRunAt: number): { label: string; overdue: boolean } {
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

function getJobStatusTone(job: ScheduledJobDetails): "active" | "paused" | "error" {
	if (!job.enabled) return "paused";
	if (job.lastError) return "error";
	return "active";
}

function getRunStatusTone(run: SessionSummary): "running" | "saved" {
	return run.busy ? "running" : "saved";
}

function renderStatusBadge(label: string, tone: "active" | "paused" | "error" | "running" | "saved" | "neutral") {
	const colors: Record<string, string> = {
		active: "border-accent-line bg-accent-soft text-accent",
		paused: "border-line bg-ink-soft text-muted",
		error: "border-danger-line bg-danger-soft text-danger",
		running: "border-accent-line bg-accent-soft text-accent",
		saved: "border-line bg-surface-muted text-muted",
		neutral: "border-line bg-ink-soft text-muted",
	};

	return (
		<span className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[0.69rem] uppercase tracking-[0.12em] ${colors[tone]}`}>
			{tone === "running" ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> : null}
			{label}
		</span>
	);
}

const ACCENT_BORDER: Record<string, string> = {
	active: "border-l-[3px] border-l-accent",
	paused: "border-l-[3px] border-l-line",
	error: "border-l-[3px] border-l-danger",
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
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const [selectedJobId, setSelectedJobId] = useState<string | null>(jobs[0]?.id ?? null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [intervalMinutes, setIntervalMinutes] = useState("");
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [isMutating, setIsMutating] = useState(false);

	// Auto-clear action feedback after a few seconds.
	useEffect(() => {
		if (!actionMessage && !actionError) return;
		const timer = window.setTimeout(() => {
			setActionMessage(null);
			setActionError(null);
		}, 4_000);
		return () => window.clearTimeout(timer);
	}, [actionMessage, actionError]);

	const selectedJob = useMemo(
		() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
		[jobs, selectedJobId],
	);

	const selectedRunCache = selectedRunId ? sessionCache.get(selectedRunId) ?? null : null;
	const selectedRun = useMemo(
		() => jobRuns.find((run) => run.id === selectedRunId) ?? null,
		[jobRuns, selectedRunId],
	);
	const selectedRunTranscript = selectedRunCache?.transcriptLoaded
		? selectedRunCache.transcript.filter((message) => message.role !== "user" && message.role !== "system")
		: [];
	const selectedRunTranscriptLoaded = selectedRunCache?.transcriptLoaded ?? false;

	// Keep selectedJobId in sync when job list changes.
	useEffect(() => {
		if (jobs.length === 0) { setSelectedJobId(null); return; }
		if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
			setSelectedJobId(jobs[0]?.id ?? null);
		}
	}, [jobs, selectedJobId]);

	// Populate the interval input when the selected job changes.
	useEffect(() => {
		if (!selectedJob) { setIntervalMinutes(""); return; }
		setIntervalMinutes(String(Math.max(5, Math.round(selectedJob.intervalMs / 60_000))));
	}, [selectedJob?.id, selectedJob?.intervalMs]);

	// Load runs when a job is selected.
	useEffect(() => {
		if (!selectedJobId) { setSelectedRunId(null); return; }
		setActionMessage(null);
		setActionError(null);
		setSelectedRunId(null);
		onRefreshJobRuns(selectedJobId);
	}, [onRefreshJobRuns, selectedJobId]);

	// Keep selectedRunId in sync when runs list changes.
	useEffect(() => {
		if (jobRuns.length === 0) { setSelectedRunId(null); return; }
		if (!selectedRunId || !jobRuns.some((run) => run.id === selectedRunId)) {
			setSelectedRunId(jobRuns[0]?.id ?? null);
		}
	}, [jobRuns, selectedRunId]);

	// Load transcript when a run is selected.
	useEffect(() => {
		if (selectedRunId && !selectedRunTranscriptLoaded) {
			onEnsureRunLoaded(selectedRunId);
		}
	}, [onEnsureRunLoaded, selectedRunId, selectedRunTranscriptLoaded]);

	async function handleSaveInterval(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedJob) return;

		const minutes = Number(intervalMinutes);
		if (!Number.isFinite(minutes) || minutes < 5) {
			setActionError("The schedule interval must be at least 5 minutes.");
			setActionMessage(null);
			return;
		}

		setIsMutating(true);
		setActionError(null);
		setActionMessage(null);
		try {
			await onUpdateJobInterval(selectedJob.id, minutes);
			setActionMessage("Schedule updated.");
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsMutating(false);
		}
	}

	async function handleToggleEnabled() {
		if (!selectedJob) return;
		setIsMutating(true);
		setActionError(null);
		setActionMessage(null);
		try {
			await onToggleJobEnabled(selectedJob.id, !selectedJob.enabled);
			setActionMessage(selectedJob.enabled ? "Job paused." : "Job resumed.");
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsMutating(false);
		}
	}

	async function handleDeleteJob() {
		if (!selectedJob) return;
		if (!window.confirm(`Delete the scheduled job "${selectedJob.name}"? This cannot be undone.`)) return;

		setIsMutating(true);
		setActionError(null);
		setActionMessage(null);
		try {
			await onDeleteJob(selectedJob.id);
			setActionMessage("Job deleted.");
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsMutating(false);
		}
	}

	const runEmptyState = !selectedRun
		? selectedJob && isLoadingJobRuns
			? { title: "Loading runs...", body: `Fetching executions for ${selectedJob.name}.` }
			: { title: selectedJob ? "No runs yet" : "Select a job", body: selectedJob ? "This job has not executed yet." : "Pick a job to inspect its executions." }
		: !selectedRunTranscriptLoaded
			? { title: "Loading transcript...", body: "The execution history is being loaded from the local server." }
			: null;

	const selectedJobTone = selectedJob ? getJobStatusTone(selectedJob) : "paused";
	const nextRunRelative = selectedJob ? formatNextRunRelative(selectedJob.nextRunAt) : null;

	const totalRuns = jobRuns.length;
	const runningRuns = jobRuns.filter((r) => r.busy).length;

	return (
		<main className="min-h-svh bg-canvas text-ink">
			<div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 py-5 min-[860px]:px-6 min-[1180px]:px-8">
				{/* ---- Header ---- */}
				<header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
					<div>
						<div className="flex items-center gap-3">
							<p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-muted">Job Dashboard</p>
							{jobs.length > 0 ? renderStatusBadge(`${jobs.length} job${jobs.length !== 1 ? "s" : ""}`, "neutral") : null}
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

				{/* ---- Server status strip ---- */}
				{adminStatus ? (
					<div className="mt-5 flex items-center gap-3 border border-line bg-surface px-4 py-3 text-sm">
						<span className="inline-flex items-center gap-1.5 font-mono text-[0.69rem] uppercase tracking-[0.1em] text-muted">
							<span className="inline-block h-2 w-2 rounded-full bg-accent" />
							Server :{adminStatus.port}
						</span>
						<span className="text-line-strong">·</span>
						<span className="font-mono text-[0.69rem] uppercase tracking-[0.1em] text-muted">
							{adminStatus.relayReady ? "Relay paired" : "Awaiting relay"}
						</span>
					</div>
				) : null}

				{/* ---- Main grid ---- */}
				<div className="mt-5 grid flex-1 gap-5 min-[1180px]:grid-cols-[minmax(280px,0.78fr)_minmax(0,1.22fr)]">
					{/* ======== LEFT: Job List ======== */}
					<section className="flex min-h-0 flex-col border border-line bg-surface">
						<div className="border-b border-line px-5 py-4">
							<h2 className="text-base font-semibold">All jobs</h2>
						</div>

						{jobsError ? (
							<div className="m-4 border border-danger-line bg-danger-soft px-4 py-3 text-sm leading-6 text-danger">{jobsError}</div>
						) : null}

						<div className="flex-1 overflow-y-auto px-3 py-3">
							{jobs.length === 0 && !isLoadingJobs ? (
								<div className="border border-line bg-surface-strong px-4 py-5 text-sm leading-6 text-muted">
									<p className="font-medium text-ink">No scheduled jobs</p>
									<p className="mt-1">Ask the agent to create a recurring job to see it here.</p>
								</div>
							) : (
								<div className="space-y-2">
									{jobs.map((job) => {
										const isSelected = job.id === selectedJob?.id;
										const tone = getJobStatusTone(job);
										const relative = formatNextRunRelative(job.nextRunAt);

										return (
											<button
												key={job.id}
												type="button"
												onClick={() => setSelectedJobId(job.id)}
												className={`flex w-full flex-col border px-3.5 py-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${ACCENT_BORDER[tone]} ${
													isSelected
														? "border-ink bg-ink text-sidebar-ink"
														: "border-line bg-surface-strong text-ink hover:border-line-strong"
												}`}
											>
												<div className="flex items-start justify-between gap-2">
													<p className={`min-w-0 flex-1 truncate text-sm font-semibold ${isSelected ? "text-sidebar-ink" : "text-ink"}`}>
														{job.name}
													</p>
													{job.enabled
														? renderStatusBadge(relative.overdue ? "Overdue" : "Active", relative.overdue ? "error" : "active")
														: renderStatusBadge("Paused", "paused")}
												</div>
												<p className={`mt-1.5 line-clamp-2 text-[0.8rem] leading-5 ${isSelected ? "text-white/60" : "text-muted"}`}>
													{job.prompt}
												</p>
												<div className={`mt-2.5 flex items-center gap-3 font-mono text-[0.69rem] tracking-[0.08em] ${isSelected ? "text-white/48" : "text-muted"}`}>
													<span>{formatInterval(job.intervalMs)}</span>
													<span className={relative.overdue && job.enabled ? "text-danger" : ""}>
														{relative.label}
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

					{/* ======== RIGHT: Inspector + Runs + Transcript ======== */}
					<section className="flex min-h-0 flex-col gap-5">
						{/* ---- Inspector ---- */}
						<div className="border border-line bg-surface">
							<div className="border-b border-line px-5 py-4">
								<div className="flex items-center justify-between gap-3">
									<h2 className="text-base font-semibold">Inspector</h2>
									{selectedJob ? renderStatusBadge(selectedJobTone === "active" ? "Active" : selectedJobTone === "error" ? "Error" : "Paused", selectedJobTone) : renderStatusBadge("No selection", "neutral")}
								</div>
							</div>

							{/* Feedback messages */}
							{actionMessage ? (
								<div className="mx-5 mt-4 border border-accent-line bg-accent-soft px-4 py-3 text-sm leading-6 text-accent">{actionMessage}</div>
							) : null}
							{actionError ? (
								<div className="mx-5 mt-4 border border-danger-line bg-danger-soft px-4 py-3 text-sm leading-6 text-danger">{actionError}</div>
							) : null}

							{selectedJob ? (
								<div className="px-5 py-5">
									{/* Metrics row */}
									<div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-4">
										<div className="border border-line bg-surface-strong px-3 py-3">
											<p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">Interval</p>
											<p className="mt-1.5 text-base font-semibold text-ink">{formatInterval(selectedJob.intervalMs)}</p>
										</div>
										<div className="border border-line bg-surface-strong px-3 py-3">
											<p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">Total runs</p>
											<p className="mt-1.5 text-base font-semibold text-ink">{selectedJob.runCount}</p>
										</div>
										<div className="border border-line bg-surface-strong px-3 py-3">
											<p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">Next run</p>
											<p className={`mt-1.5 text-base font-semibold ${nextRunRelative?.overdue ? "text-danger" : "text-ink"}`}>
												{nextRunRelative?.label ?? "—"}
											</p>
											<p className="mt-0.5 text-[0.72rem] text-muted">{formatTimestamp(selectedJob.nextRunAt)}</p>
										</div>
										<div className="border border-line bg-surface-strong px-3 py-3">
											<p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">Last run</p>
											<p className="mt-1.5 text-sm text-ink">{formatTimestamp(selectedJob.lastRunAt)}</p>
										</div>
									</div>

									{/* Prompt */}
									<div className="mt-4 border border-line bg-surface-strong px-4 py-4">
										<p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">Prompt</p>
										<p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{selectedJob.prompt}</p>
									</div>

									{/* Interval form */}
									<form className="mt-4 flex items-end gap-3" onSubmit={handleSaveInterval}>
										<label className="min-w-0 flex-1">
											<span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">Cycle (minutes)</span>
											<input
												type="number"
												min={5}
												step={1}
												value={intervalMinutes}
												onChange={(event) => setIntervalMinutes(event.target.value)}
												className="mt-1.5 block w-full border border-line bg-surface-strong px-3 py-2.5 font-mono text-sm tracking-[0.04em] text-ink outline-none transition focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
											/>
										</label>
										<button
											type="submit"
											className="border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-sidebar-ink transition hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45"
											disabled={isMutating || intervalMinutes.trim().length === 0}
										>
											{isMutating ? "Saving..." : "Update"}
										</button>
									</form>

									{/* Actions */}
									<div className="mt-4 flex flex-wrap gap-3">
										<button
											type="button"
											className={`border px-4 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45 ${
												selectedJob.enabled
													? "border-danger-line bg-danger-soft text-danger hover:bg-danger/12"
													: "border-accent-line bg-accent-soft text-accent hover:bg-accent/16"
											}`}
											onClick={() => { void handleToggleEnabled(); }}
											disabled={isMutating}
										>
											{selectedJob.enabled ? "Pause job" : "Resume job"}
										</button>
										<button
											type="button"
											className="border border-line bg-surface-strong px-4 py-2.5 text-sm font-medium text-muted transition hover:border-danger-line hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45"
											onClick={() => { void handleDeleteJob(); }}
											disabled={isMutating}
										>
											Delete
										</button>
									</div>

									{/* Error / guardrails */}
									{selectedJob.lastError ? (
										<div className="mt-4 border border-danger-line bg-danger-soft px-4 py-3.5 text-sm leading-6">
											<p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-danger">Last execution error</p>
											<p className="mt-1.5 break-words text-danger">{selectedJob.lastError}</p>
										</div>
									) : null}

									<div className="mt-4 flex items-center gap-4 border border-line bg-ink-soft px-4 py-3 text-sm text-muted">
										<span className="font-mono text-[0.65rem] uppercase tracking-[0.14em]">Max catchup: {selectedJob.maxCatchup}</span>
										<span className="text-line" aria-hidden="true">|</span>
										<span>Job ID: <span className="font-mono text-[0.72rem] text-ink">{selectedJob.id.slice(0, 8)}...</span></span>
										<span className="text-line" aria-hidden="true">|</span>
										<span>Updated {formatTimestamp(selectedJob.updatedAt)}</span>
									</div>
								</div>
							) : (
								<div className="px-5 py-8 text-center text-sm leading-6 text-muted">
									<p className="font-medium text-ink">No job selected</p>
									<p className="mt-1">Select a scheduled job from the list to inspect its configuration.</p>
								</div>
							)}
						</div>

						{/* ---- Run History ---- */}
						<div className="border border-line bg-surface">
							<div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
								<div>
									<h2 className="text-base font-semibold">Run history</h2>
									{selectedJob && totalRuns > 0 ? (
										<p className="mt-0.5 font-mono text-[0.69rem] text-muted">
											{totalRuns} run{totalRuns !== 1 ? "s" : ""}{runningRuns > 0 ? ` · ${runningRuns} running` : ""}
										</p>
									) : null}
								</div>
								<div className="flex items-center gap-2">
									{totalRuns > 0 ? renderStatusBadge(`${totalRuns}`, "neutral") : null}
									<button
										type="button"
										className="border border-line bg-surface-strong px-2.5 py-1.5 text-sm font-medium text-ink transition hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
										onClick={() => { if (selectedJob) onRefreshJobRuns(selectedJob.id); }}
										disabled={isLoadingJobRuns || !selectedJob}
									>
										{isLoadingJobRuns ? "Refreshing..." : "Refresh"}
									</button>
								</div>
							</div>

							{jobRunsError ? (
								<div className="m-4 border border-danger-line bg-danger-soft px-4 py-3 text-sm leading-6 text-danger">{jobRunsError}</div>
							) : null}

							<div className="max-h-[20rem] overflow-y-auto px-3 py-3">
								{jobRuns.length === 0 && !isLoadingJobRuns ? (
									<div className="border border-line bg-surface-strong px-4 py-5 text-sm leading-6 text-muted">
										<p className="font-medium text-ink">No runs recorded</p>
										<p className="mt-1">{selectedJob ? "This job has not executed yet." : "Select a job to see its execution history."}</p>
									</div>
								) : (
									<div className="space-y-2">
										{jobRuns.map((run) => {
											const isSelected = run.id === selectedRun?.id;
											const tone = getRunStatusTone(run);

											return (
										<button
											key={run.id}
											type="button"
											className={`flex w-full items-center gap-3 border px-3.5 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
												isSelected
													? "border-ink bg-ink text-sidebar-ink"
													: "border-line bg-surface-strong text-ink hover:border-line-strong"
											}`}
											onClick={() => setSelectedRunId(run.id)}
										>
											<span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${tone === "running" ? "bg-accent animate-pulse" : "bg-muted"}`} />
											<div className="min-w-0 flex-1">
												<p className={`truncate text-sm font-medium ${isSelected ? "text-sidebar-ink" : "text-ink"}`}>
														{run.busy ? "Run in progress" : `Run ${formatTimestamp(run.createdAt)}`}
													</p>
													<p className={`mt-0.5 text-[0.72rem] leading-5 font-mono tracking-[0.04em] ${isSelected ? "text-white/48" : "text-muted"}`}>
														{tone === "running" ? "Running" : "Saved"} · {run.messageCount} msg{run.messageCount !== 1 ? "s" : ""} · {formatTimestamp(run.updatedAt)}
													</p>
												</div>
													<svg className={`h-4 w-4 shrink-0 ${isSelected ? "text-white/60" : "text-faint"}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
														<path strokeLinecap="round" strokeLinejoin="round" d="M6 4l4 4-4 4" />
													</svg>
												</button>
											);
										})}
									</div>
								)}
							</div>
						</div>

						{/* ---- Transcript Viewer ---- */}
						<div className="flex min-h-[24rem] flex-1 flex-col overflow-hidden border border-line bg-surface">
							<div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
								<div>
									<h2 className="text-base font-semibold">Transcript</h2>
									{selectedRun ? (
										<p className="mt-0.5 font-mono text-[0.69rem] text-muted">
											{selectedRun.messageCount} message{selectedRun.messageCount !== 1 ? "s" : ""} · {selectedRun.busy ? "In progress" : "Completed"}
										</p>
									) : null}
								</div>
								{selectedRun ? renderStatusBadge(selectedRun.busy ? "Running" : "Saved", selectedRun.busy ? "running" : "saved") : renderStatusBadge("No run selected", "neutral")}
							</div>
							<TranscriptPanel
								transcriptRef={transcriptRef}
								activeSession={selectedRun}
								activeTranscript={selectedRunTranscript}
								emptyState={runEmptyState}
								connectionError={connectionError}
							/>
						</div>
					</section>
				</div>
			</div>
		</main>
	);
}
