import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalWebAdminStatus } from "@apreal/shared";
import type { SessionCacheEntry, SessionSummary, ScheduledJobDetails } from "../chatTypes";
import { TranscriptPanel } from "./TranscriptPanel";

type JobsPanelProps = {
	adminStatus: LocalWebAdminStatus | null;
	jobs: ScheduledJobDetails[];
	jobRuns: SessionSummary[];
	sessionCache: Map<string, SessionCacheEntry>;
	jobsError: string | null;
	jobRunsError: string | null;
	isLoadingJobs: boolean;
	isLoadingJobRuns: boolean;
	connectionError: string | null;
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
	if (minutes < 60) return `${minutes}m`;
	const hours = minutes / 60;
	return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
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
		active: "border-slate-300 bg-white text-slate-800",
		paused: "border-slate-300 bg-slate-100 text-slate-500",
		error: "border-slate-400 bg-slate-200 text-slate-800",
		running: "border-slate-900 bg-slate-900 text-white",
		saved: "border-slate-300 bg-slate-100 text-slate-600",
		neutral: "border-slate-300 bg-slate-100 text-slate-500",
	};

	return (
		<span className={`inline-flex items-center gap-1.5 border rounded-md px-2 py-0.5 font-mono text-[0.64rem] font-bold uppercase tracking-[0.1em] ${colors[tone]}`}>
			{tone === "running" ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" /> : null}
			{label}
		</span>
	);
}

const ACCENT_BORDER: Record<string, string> = {
	active: "border-l-2 border-l-slate-900",
	paused: "border-l-2 border-l-slate-300",
	error: "border-l-2 border-l-slate-500",
};

export function JobsPanel({
	adminStatus,
	jobs,
	jobRuns,
	sessionCache,
	jobsError,
	jobRunsError,
	isLoadingJobs,
	isLoadingJobRuns,
	connectionError,
	onRefreshJobs,
	onRefreshJobRuns,
	onUpdateJobInterval,
	onToggleJobEnabled,
	onDeleteJob,
	onEnsureRunLoaded,
}: JobsPanelProps) {
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const [selectedJobId, setSelectedJobId] = useState<string | null>(jobs[0]?.id ?? null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [intervalMinutes, setIntervalMinutes] = useState("");
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [isMutating, setIsMutating] = useState(false);

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

	useEffect(() => {
		if (jobs.length === 0) { setSelectedJobId(null); return; }
		if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
			setSelectedJobId(jobs[0]?.id ?? null);
		}
	}, [jobs, selectedJobId]);

	useEffect(() => {
		if (!selectedJob) { setIntervalMinutes(""); return; }
		setIntervalMinutes(String(Math.max(5, Math.round(selectedJob.intervalMs / 60_000))));
	}, [selectedJob?.id, selectedJob?.intervalMs]);

	useEffect(() => {
		if (!selectedJobId) { setSelectedRunId(null); return; }
		setActionMessage(null);
		setActionError(null);
		setSelectedRunId(null);
		onRefreshJobRuns(selectedJobId);
	}, [onRefreshJobRuns, selectedJobId]);

	useEffect(() => {
		if (jobRuns.length === 0) { setSelectedRunId(null); return; }
		if (!selectedRunId || !jobRuns.some((run) => run.id === selectedRunId)) {
			setSelectedRunId(jobRuns[0]?.id ?? null);
		}
	}, [jobRuns, selectedRunId]);

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
			setActionMessage("Schedule updated successfully.");
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
		if (!window.confirm(`Delete scheduled job "${selectedJob.name}"? This cannot be undone.`)) return;

		setIsMutating(true);
		setActionError(null);
		setActionMessage(null);
		try {
			await onDeleteJob(selectedJob.id);
			setActionMessage("Job deleted successfully.");
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsMutating(false);
		}
	}

	const runEmptyState = !selectedRun
		? selectedJob && isLoadingJobRuns
				? { title: "Loading history...", body: `Fetching executions for ${selectedJob.name}.` }
				: { title: selectedJob ? "No executions yet" : "Select a job", body: selectedJob ? "This job has not been executed yet." : "Pick a job from the left panel to inspect its executions." }
		: !selectedRunTranscriptLoaded
				? { title: "Loading transcript...", body: "The execution history is being loaded from the local server." }
				: null;

	const selectedJobTone = selectedJob ? getJobStatusTone(selectedJob) : "paused";
	const nextRunRelative = selectedJob ? formatNextRunRelative(selectedJob.nextRunAt) : null;

	const totalRuns = jobRuns.length;
	const runningRuns = jobRuns.filter((r) => r.busy).length;

	return (
		<div className="flex flex-col gap-4">
			{/* ---- Main grid ---- */}
			<div className="grid gap-4 min-[1180px]:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.22fr)] items-start">
				{/* ======== LEFT: Job List ======== */}
				<section className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white overflow-hidden">
					<div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
						<h2 className="text-[0.95rem] font-bold text-slate-950">Active Recurring Schedules</h2>
						{jobs.length > 0 && <span className="text-[0.68rem] text-slate-500 font-semibold font-mono bg-slate-100 px-2 py-0.5 rounded-sm">{jobs.length} Active</span>}
					</div>

					{jobsError ? (
						<div className="m-3 rounded-md border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs font-semibold leading-5 text-slate-800">{jobsError}</div>
					) : null}

					<div className="flex-1 overflow-y-auto px-3 py-3.5 scrollbar-thin">
						{jobs.length === 0 && !isLoadingJobs ? (
							<div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm leading-[1.5]">
								<p className="font-bold text-slate-800">No scheduled jobs</p>
								<p className="mt-1 text-slate-400 font-medium">Ask Pi inside chat to create a recurring scheduled job to monitor anything.</p>
							</div>
						) : (
							<div className="space-y-2.5">
								{jobs.map((job) => {
									const isSelected = job.id === selectedJob?.id;
									const tone = getJobStatusTone(job);
									const relative = formatNextRunRelative(job.nextRunAt);

									return (
										<button
											key={job.id}
											type="button"
											onClick={() => setSelectedJobId(job.id)}
									className={`flex w-full flex-col rounded-md border p-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer ${ACCENT_BORDER[tone]} ${
										isSelected
											? "border-slate-900 bg-[#171717] text-white"
											: "border-slate-150 bg-[#f8fafc]/60 text-[#0f172a] hover:border-slate-200 hover:bg-slate-50"
									}`}
										>
											<div className="flex items-start justify-between gap-3 w-full">
											<p className={`min-w-0 flex-1 truncate text-[0.84rem] font-bold ${isSelected ? "text-white" : "text-slate-900"}`}>
													{job.name}
												</p>
												{job.enabled
													? renderStatusBadge(relative.overdue ? "Overdue" : "Active", relative.overdue ? "error" : "active")
													: renderStatusBadge("Paused", "paused")}
											</div>
											<p className={`mt-2 line-clamp-2 text-[0.76rem] leading-[1.45] font-medium ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
												{job.prompt}
											</p>
											<div className={`mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.64rem] font-bold tracking-wider ${isSelected ? "text-slate-400" : "text-slate-400"}`}>
												<span className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-sm border border-white/5">
													Interval: {formatInterval(job.intervalMs)}
												</span>
												<span className={`flex items-center gap-1 ${relative.overdue && job.enabled ? "text-slate-200" : ""}`}>
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

				{/* ======== RIGHT: Inspector + Runs + Transcript ======== */}
				<section className="flex min-h-0 flex-col gap-4">
					{/* ---- Inspector ---- */}
					<div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
						<div className="border-b border-slate-200 px-4 py-3">
							<div className="flex items-center justify-between gap-3">
								<h2 className="text-[0.95rem] font-bold text-slate-950">Job Configuration Inspector</h2>
								{selectedJob ? renderStatusBadge(selectedJobTone === "active" ? "Active Schedule" : selectedJobTone === "error" ? "Handshake Error" : "Paused", selectedJobTone) : renderStatusBadge("No Selection", "neutral")}
							</div>
						</div>

						{actionMessage ? (
							<div className="mx-4 mt-3 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold leading-5 text-slate-700">{actionMessage}</div>
						) : null}
						{actionError ? (
							<div className="mx-4 mt-3 rounded-md border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs font-semibold leading-5 text-slate-800">{actionError}</div>
						) : null}

						{selectedJob ? (
							<div className="px-4 py-4">
								<div className="grid grid-cols-2 gap-2.5 min-[700px]:grid-cols-4">
									<div className="rounded-md border border-slate-200 bg-slate-50 p-3">
										<p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-400">Interval Cycle</p>
										<p className="mt-1.5 text-base font-bold text-slate-900 font-mono">{formatInterval(selectedJob.intervalMs)}</p>
									</div>
									<div className="rounded-md border border-slate-200 bg-slate-50 p-3">
										<p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-400">Total Run Count</p>
										<p className="mt-1.5 text-base font-bold text-slate-900 font-mono">{selectedJob.runCount}</p>
									</div>
									<div className="rounded-md border border-slate-200 bg-slate-50 p-3">
										<p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-400">Next Scheduled Run</p>
										<p className={`mt-1.5 text-sm font-bold font-mono ${nextRunRelative?.overdue ? "text-slate-900" : "text-slate-800"}`}>
											{nextRunRelative?.label ?? "—"}
										</p>
										<p className="mt-1 text-[0.7rem] text-slate-400 font-medium font-mono">{formatTimestamp(selectedJob.nextRunAt)}</p>
									</div>
									<div className="rounded-md border border-slate-200 bg-slate-50 p-3">
										<p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-400">Last Execution</p>
										<p className="mt-1.5 text-xs font-bold text-slate-900 font-mono">{formatTimestamp(selectedJob.lastRunAt)}</p>
									</div>
								</div>

								<div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3.5">
									<p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-400">Target Prompt Directive</p>
									<p className="mt-2 whitespace-pre-wrap break-words text-sm leading-[1.6] font-medium text-slate-800">{selectedJob.prompt}</p>
								</div>

								<form className="mt-3 flex flex-col gap-2.5 min-[640px]:flex-row min-[640px]:items-end" onSubmit={handleSaveInterval}>
									<label className="min-w-0 flex-1">
										<span className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-400">Frequency Interval (minutes)</span>
										<input
											type="number"
											min={5}
											step={1}
											value={intervalMinutes}
											onChange={(event) => setIntervalMinutes(event.target.value)}
											className="mt-1.5 block w-full rounded-md border border-slate-300 bg-[#f8f8f8] px-3 py-2.5 font-mono text-sm font-bold text-[#171717] outline-none transition focus:border-slate-500 focus:bg-white"
										/>
									</label>
									<button
										type="submit"
										className="w-full rounded-md border border-black bg-black px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer min-[640px]:w-auto"
										disabled={isMutating || intervalMinutes.trim().length === 0}
									>
										{isMutating ? "Syncing..." : "Update Schedule"}
									</button>
								</form>

								<div className="mt-3.5 flex flex-col gap-2.5 min-[520px]:flex-row min-[520px]:flex-wrap">
									<button
										type="button"
									className={`w-full rounded-md border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer min-[520px]:w-auto ${
										selectedJob.enabled
											? "border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200"
											: "border-slate-900 bg-slate-900 text-white hover:bg-black"
									}`}
										onClick={() => { void handleToggleEnabled(); }}
										disabled={isMutating}
									>
										{selectedJob.enabled ? "Pause schedule" : "Resume schedule"}
									</button>
									<button
										type="button"
									className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer min-[520px]:w-auto"
										onClick={() => { void handleDeleteJob(); }}
										disabled={isMutating}
									>
										Delete job
									</button>
								</div>

								{selectedJob.lastError ? (
									<div className="mt-3 rounded-md border border-slate-300 bg-slate-100 p-3.5 text-[0.84rem] leading-[1.5]">
										<p className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-700">Last Execution Error</p>
										<p className="mt-2 break-all text-slate-800 font-semibold">{selectedJob.lastError}</p>
									</div>
								) : null}

								<div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500 font-medium">
									<span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em]">Catchup: {selectedJob.maxCatchup}</span>
									<span className="text-slate-300" aria-hidden="true">|</span>
									<span>System ID: <span className="font-mono text-[0.72rem] text-slate-800 bg-white border border-slate-200 px-1.5 py-0.5 rounded-sm">{selectedJob.id.slice(0, 8)}...</span></span>
									<span className="text-slate-300" aria-hidden="true">|</span>
									<span>Updated: {formatTimestamp(selectedJob.updatedAt)}</span>
								</div>
							</div>
						) : (
							<div className="px-4 py-6 text-center text-sm leading-[1.5] text-slate-500 font-semibold border-t border-slate-200">
								<p className="text-slate-800">No recurring job selected</p>
								<p className="mt-1 font-medium">Select a job from the lists to inspect settings and state logs.</p>
							</div>
						)}
					</div>

					{/* ---- Run History ---- */}
					<div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
						<div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
							<div>
								<h2 className="text-[0.95rem] font-bold text-slate-950">Run History Log</h2>
								{selectedJob && totalRuns > 0 ? (
									<p className="mt-1 font-mono text-[0.69rem] font-bold text-slate-400">
										{totalRuns} Total Run{totalRuns !== 1 ? "s" : ""}{runningRuns > 0 ? ` · ${runningRuns} actively running` : ""}
									</p>
								) : null}
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{totalRuns > 0 ? renderStatusBadge(`${totalRuns} total`, "neutral") : null}
								<button
									type="button"
									className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-[#171717] transition hover:bg-slate-100 cursor-pointer"
									onClick={() => { if (selectedJob) onRefreshJobRuns(selectedJob.id); }}
									disabled={isLoadingJobRuns || !selectedJob}
								>
									{isLoadingJobRuns ? "Syncing..." : "Sync Runs"}
								</button>
							</div>
						</div>

						{jobRunsError ? (
							<div className="m-3 rounded-md border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs font-semibold leading-5 text-slate-800">{jobRunsError}</div>
						) : null}

						<div className="max-h-[20rem] overflow-y-auto px-3 py-3.5 scrollbar-thin">
							{jobRuns.length === 0 && !isLoadingJobRuns ? (
								<div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm leading-[1.5] text-slate-500 font-semibold">
									<p className="text-slate-800">No recorded executions</p>
									<p className="mt-1 font-medium">{selectedJob ? "This scheduled job has not run yet." : "Select a recurring job to view recorded transcripts."}</p>
								</div>
							) : (
								<div className="space-y-1.5">
									{jobRuns.map((run) => {
										const isSelected = run.id === selectedRun?.id;
										const tone = getRunStatusTone(run);

										return (
											<button
												key={run.id}
												type="button"
										className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer ${
											isSelected
												? "border-slate-900 bg-[#171717] text-white"
												: "border-slate-150 bg-[#f8fafc]/60 text-[#0f172a] hover:border-slate-200 hover:bg-slate-50"
										}`}
												onClick={() => setSelectedRunId(run.id)}
											>
												<span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${tone === "running" ? "bg-white" : "bg-slate-400"}`} />
												<div className="min-w-0 flex-1">
													<p className={`truncate text-sm font-extrabold ${isSelected ? "text-white" : "text-slate-950"}`}>
														{run.busy ? "Active execution run..." : `Execution run ${formatTimestamp(run.createdAt)}`}
													</p>
													<p className={`mt-1.5 text-[0.72rem] leading-tight font-mono tracking-wider font-semibold ${isSelected ? "text-slate-400" : "text-slate-400"}`}>
														{tone === "running" ? "Active" : "Saved"} · {run.messageCount} msg{run.messageCount !== 1 ? "s" : ""} · Sync {formatTimestamp(run.updatedAt)}
													</p>
												</div>
												<svg className={`h-4 w-4 shrink-0 transition-transform ${isSelected ? "text-white translate-x-0.5" : "text-slate-400"}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.2}>
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
					<div className="flex min-h-[24rem] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
						<div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
							<div>
								<h2 className="text-[0.95rem] font-bold text-slate-950">Execution Transcript Log</h2>
								{selectedRun ? (
									<p className="mt-1 font-mono text-[0.69rem] font-bold text-slate-400">
										{selectedRun.messageCount} message{selectedRun.messageCount !== 1 ? "s" : ""} · {selectedRun.busy ? "Actively writing" : "Execution completed"}
									</p>
								) : null}
							</div>
							{selectedRun ? renderStatusBadge(selectedRun.busy ? "Running" : "Saved Log", selectedRun.busy ? "running" : "saved") : renderStatusBadge("No execution trace selected", "neutral")}
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
	);
}
