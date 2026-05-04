import { createLogger } from "../logger.ts";
import type { ScheduledJob } from "./types.ts";
import { JobStore } from "./store.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const RUNNING_GUARD = new Set<string>();

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

export class Scheduler {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private stopped = false;

	constructor(
		private readonly store: JobStore,
		private readonly logger: ReturnType<typeof createLogger>,
		private readonly executor: (job: ScheduledJob) => Promise<void>,
	) {}

	async start(): Promise<void> {
		this.stopped = false;
		const now = Date.now();
		for (const job of this.store.listEnabledJobs()) {
			if (job.nextRunAt <= now) {
				this.handleOverdueJob(job, now);
				continue;
			}

			this.armTimer(job, job.nextRunAt - now);
		}
	}

	stop(): void {
		this.stopped = true;
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		RUNNING_GUARD.clear();
	}

	scheduleJob(job: ScheduledJob): void {
		this.clearTimer(job.id);
		if (this.stopped || !job.enabled) {
			return;
		}

		const now = Date.now();
		if (job.nextRunAt <= now) {
			this.handleOverdueJob(job, now);
			return;
		}

		this.armTimer(job, job.nextRunAt - now);
	}

	private clearTimer(jobId: string): void {
		const existingTimer = this.timers.get(jobId);
		if (!existingTimer) {
			return;
		}

		clearTimeout(existingTimer);
		this.timers.delete(jobId);
	}

	private async fireJob(jobId: string): Promise<void> {
		if (this.stopped) {
			return;
		}

		this.clearTimer(jobId);

		const job = this.store.getJob(jobId);
		if (!job || !job.enabled) {
			return;
		}

		const now = Date.now();
		if (job.nextRunAt > now) {
			this.scheduleJob(job);
			return;
		}

		if (RUNNING_GUARD.has(jobId)) {
			this.logger.warn("scheduled job already running; skipping overlapping fire", {
				jobId,
				name: job.name,
			});
			return;
		}

		RUNNING_GUARD.add(jobId);
		try {
			await this.executor(job);
		} catch (error) {
			const errorMessage = formatError(error);
			this.logger.error("scheduled job execution failed", {
				jobId,
				name: job.name,
				error: errorMessage,
			});
			this.store.markJobRun(jobId, Date.now(), errorMessage);
		} finally {
			RUNNING_GUARD.delete(jobId);

			const currentJob = this.store.getJob(jobId);
			if (!this.stopped && currentJob?.enabled) {
				this.store.updateNextRun(jobId, Date.now() + currentJob.intervalMs);
				await this.reschedule(jobId);
			}
		}
	}

	handleOverdueJob(job: ScheduledJob, now = Date.now()): void {
		const missedCycles = Math.floor((now - job.nextRunAt) / job.intervalMs) + 1;
		const catchupRuns = Math.min(missedCycles, job.maxCatchup);
		const nextRunAt = now + job.intervalMs;

		this.store.updateNextRun(job.id, nextRunAt);
		if (catchupRuns > 0 && !this.stopped) {
			setImmediate(() => {
				void this.fireJob(job.id);
			});
		}

		this.armTimer({ ...job, nextRunAt }, nextRunAt - now);
	}

	armTimer(job: ScheduledJob, delayMs: number): void {
		if (this.stopped || !job.enabled) {
			return;
		}

		this.clearTimer(job.id);
		const safeDelay = Math.max(0, Math.min(delayMs, MAX_TIMEOUT_MS));
		const timer = setTimeout(() => {
			this.timers.delete(job.id);
			void this.fireJob(job.id);
		}, safeDelay);
		this.timers.set(job.id, timer);
	}

	async reschedule(jobId: string): Promise<void> {
		const job = this.store.getJob(jobId);
		if (!job || !job.enabled || this.stopped) {
			this.clearTimer(jobId);
			return;
		}

		this.scheduleJob(job);
	}
}