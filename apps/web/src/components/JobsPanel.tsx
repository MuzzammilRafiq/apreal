import { useEffect, useMemo, useState } from "react";
import type { SessionCacheEntry, SessionSummary, ScheduledJobDetails } from "../chatTypes";
import { formatInterval, formatNextRunRelative, getJobStatusTone } from "./ScheduledJobList";
import { TranscriptPanel } from "./TranscriptPanel";

type JobsPanelProps = {
	jobs: ScheduledJobDetails[];
	jobRuns: SessionSummary[];
	sessionCache: Map<string, SessionCacheEntry>;
	jobRunsError: string | null;
	isLoadingJobRuns: boolean;
	connectionError: string | null;
	onRefreshJobRuns: (jobId: string) => void;
	onUpdateJobInterval: (jobId: string, intervalMinutes: number) => Promise<void>;
	onToggleJobEnabled: (jobId: string, enabled: boolean) => Promise<void>;
	onDeleteJob: (jobId: string) => Promise<void>;
	onEnsureRunLoaded: (runId: string) => void;
	selectedJobId?: string | null;
};

function formatTimestamp(value: number | null): string {
	if (value === null) return "Never";
	return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function getRunStatusTone(run: SessionSummary): "running" | "saved" {
	return run.busy ? "running" : "saved";
}

type StatusBadgeProps = {
	label: string;
	tone: "active" | "paused" | "error" | "running" | "saved" | "neutral";
};

const STATUS_BADGE_COLORS: Record<StatusBadgeProps["tone"], string> = {
	active: "border-slate-300 bg-white text-slate-800",
	paused: "border-slate-300 bg-slate-100 text-slate-500",
	error: "border-slate-400 bg-slate-200 text-slate-800",
	running: "border-slate-900 bg-slate-900 text-white",
	saved: "border-slate-300 bg-slate-100 text-slate-600",
	neutral: "border-slate-300 bg-slate-100 text-slate-500",
};

function StatusBadge({ label, tone }: StatusBadgeProps) {
	return (
		<span className={`inline-flex items-center gap-1.5 border rounded-md px-2 py-0.5 font-mono text-[0.64rem] font-bold uppercase tracking-widest ${STATUS_BADGE_COLORS[tone]}`}>
			{tone === "running" ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" /> : null}
			{label}
		</span>
	);
}

export function JobsPanel({
	jobs,
	jobRuns,
	sessionCache,
	jobRunsError,
	isLoadingJobRuns,
	connectionError,
	onRefreshJobRuns,
	onUpdateJobInterval,
	onToggleJobEnabled,
	onDeleteJob,
	onEnsureRunLoaded,
	selectedJobId = null,
}: JobsPanelProps) {
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [intervalDraft, setIntervalDraft] = useState<{ jobId: string | null; value: string }>({ jobId: null, value: "" });
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
		() => jobs.find((job) => job.id === selectedJobId) ?? null,
		[jobs, selectedJobId],
	);
	const intervalMinutes = intervalDraft.jobId === selectedJob?.id
		? intervalDraft.value
		: selectedJob
			? String(Math.max(5, Math.round(selectedJob.intervalMs / 60_000)))
			: "";

	const selectedRun = useMemo(
		() => (selectedRunId ? jobRuns.find((run) => run.id === selectedRunId) ?? null : null),
		[jobRuns, selectedRunId],
	);
	const selectedRunCache = selectedRun ? sessionCache.get(selectedRun.id) ?? null : null;
	const selectedRunTranscript = selectedRunCache?.transcriptLoaded
		? selectedRunCache.transcript.filter((message) => message.role !== "user" && message.role !== "system")
		: [];
	const selectedRunTranscriptLoaded = selectedRunCache?.transcriptLoaded ?? false;

	function handleSelectRun(runId: string) {
		setSelectedRunId(runId);
		const runCache = sessionCache.get(runId);
		if (!runCache?.transcriptLoaded) {
			onEnsureRunLoaded(runId);
		}
	}

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
			<div>
				<section className="flex min-h-0 flex-col gap-4">
					{/* ---- Inspector ---- */}
					<div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
						<div className="border-b border-slate-200 px-4 py-3">
							<div className="flex items-center justify-between gap-3">
								<h2 className="text-[0.95rem] font-bold text-slate-950">Job Configuration Inspector</h2>
								{selectedJob ? <StatusBadge label={selectedJobTone === "active" ? "Active Schedule" : selectedJobTone === "error" ? "Handshake Error" : "Paused"} tone={selectedJobTone} /> : <StatusBadge label="No Selection" tone="neutral" />}
							</div>
						</div>

						{actionMessage ? (
							<div className="ui-feedback-soft mx-4 mt-3 rounded-md px-3 py-2.5 text-xs font-semibold leading-5">{actionMessage}</div>
						) : null}
						{actionError ? (
							<div className="ui-feedback mx-4 mt-3 rounded-md px-3 py-2.5 text-xs font-semibold leading-5">{actionError}</div>
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
									<p className="mt-2 whitespace-pre-wrap wrap-break-word text-sm leading-[1.6] font-medium text-slate-800">{selectedJob.prompt}</p>
								</div>

								<form className="mt-3 flex flex-col gap-2.5 min-[640px]:flex-row min-[640px]:items-end" onSubmit={handleSaveInterval}>
									<label className="min-w-0 flex-1">
										<span className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.14em] text-slate-400">Frequency Interval (minutes)</span>
										<input
											type="number"
											min={5}
											step={1}
											value={intervalMinutes}
											onChange={(event) => setIntervalDraft({ jobId: selectedJob.id, value: event.target.value })}
											className="ui-field-surface mt-1.5 block w-full rounded-md border px-3 py-2.5 font-mono text-sm font-bold text-[#171717] outline-none"
										/>
									</label>
									<button
										type="submit"
										className="ui-settings-action-button w-full rounded-md border px-4 py-2.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed cursor-pointer min-[640px]:w-auto"
										disabled={isMutating || intervalMinutes.trim().length === 0}
									>
										{isMutating ? "Syncing..." : "Update Schedule"}
									</button>
								</form>

								<div className="mt-3.5 flex flex-col gap-2.5 min-[520px]:flex-row min-[520px]:flex-wrap">
									<button
										type="button"
									className="ui-settings-action-button w-full rounded-md border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed cursor-pointer min-[520px]:w-auto"
										onClick={() => { void handleToggleEnabled(); }}
										disabled={isMutating}
									>
										{selectedJob.enabled ? "Pause schedule" : "Resume schedule"}
									</button>
									<button
										type="button"
									className="ui-settings-danger-button w-full cursor-pointer rounded-md border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed min-[520px]:w-auto"
										onClick={() => { void handleDeleteJob(); }}
										disabled={isMutating}
									>
										Delete job
									</button>
								</div>

								{selectedJob.lastError ? (
									<div className="ui-feedback mt-3 rounded-md p-3.5 text-[0.84rem] leading-normal">
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
							<div className="px-4 py-6 text-center text-sm leading-normal text-slate-500 font-semibold border-t border-slate-200">
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
								{totalRuns > 0 ? <StatusBadge label={`${totalRuns} total`} tone="neutral" /> : null}
								<button
									type="button"
									className="ui-settings-action-button rounded-md border px-3 py-1.5 text-xs font-bold cursor-pointer"
									onClick={() => {
										if (!selectedJob) {
											return;
										}
										setSelectedRunId(null);
										onRefreshJobRuns(selectedJob.id);
									}}
									disabled={isLoadingJobRuns || !selectedJob}
								>
									{isLoadingJobRuns ? "Syncing..." : "Sync Runs"}
								</button>
							</div>
						</div>

						{jobRunsError ? (
							<div className="m-3 rounded-md border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs font-semibold leading-5 text-slate-800">{jobRunsError}</div>
						) : null}

						<div className="max-h-80 overflow-y-auto px-3 py-3.5 scrollbar-thin">
							{jobRuns.length === 0 && !isLoadingJobRuns ? (
								<div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm leading-normal text-slate-500 font-semibold">
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
												: "border-slate-150 bg-code-surface/60 text-[#0f172a] hover:border-slate-200 hover:bg-slate-50"
										}`}
												onClick={() => handleSelectRun(run.id)}
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
					<div className="flex min-h-96 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
						<div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
							<div>
								<h2 className="text-[0.95rem] font-bold text-slate-950">Execution Transcript Log</h2>
								{selectedRun ? (
									<p className="mt-1 font-mono text-[0.69rem] font-bold text-slate-400">
										{selectedRun.messageCount} message{selectedRun.messageCount !== 1 ? "s" : ""} · {selectedRun.busy ? "Actively writing" : "Execution completed"}
									</p>
								) : null}
							</div>
							{selectedRun ? <StatusBadge label={selectedRun.busy ? "Running" : "Saved Log"} tone={selectedRun.busy ? "running" : "saved"} /> : <StatusBadge label="No execution trace selected" tone="neutral" />}
						</div>
						<TranscriptPanel
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
