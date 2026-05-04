import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../logger.ts";
import type { CreateScheduledJobInput, ScheduledJob } from "./types.ts";

const logger = createLogger("scheduled-job-store");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS scheduled_jobs (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	prompt TEXT NOT NULL,
	interval_ms INTEGER NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	last_run_at INTEGER,
	next_run_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	run_count INTEGER NOT NULL DEFAULT 0,
	max_catchup INTEGER NOT NULL DEFAULT 1,
	last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON scheduled_jobs(enabled, next_run_at);
`;

type ScheduledJobRow = {
	id: string;
	name: string;
	prompt: string;
	interval_ms: number;
	enabled: number;
	last_run_at: number | null;
	next_run_at: number;
	created_at: number;
	updated_at: number;
	run_count: number;
	max_catchup: number;
	last_error: string | null;
};

function toScheduledJob(row: ScheduledJobRow): ScheduledJob {
	return {
		id: row.id,
		name: row.name,
		prompt: row.prompt,
		intervalMs: row.interval_ms,
		enabled: row.enabled === 1,
		lastRunAt: row.last_run_at,
		nextRunAt: row.next_run_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		runCount: row.run_count,
		maxCatchup: row.max_catchup,
		lastError: row.last_error,
	};
}

export class JobStore {
	private readonly database: DatabaseSync;
	private readonly createJobStatement;
	private readonly getJobStatement;
	private readonly listEnabledJobsStatement;
	private readonly listAllJobsStatement;
	private readonly markJobRunStatement;
	private readonly updateJobIntervalStatement;
	private readonly pauseJobStatement;
	private readonly resumeJobStatement;
	private readonly updateNextRunStatement;
	private readonly setEnabledStatement;
	private readonly deleteJobStatement;

	constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.database = new DatabaseSync(dbPath, {
			enableForeignKeyConstraints: true,
			timeout: 1_000,
		});
		this.database.exec("PRAGMA foreign_keys = ON;");
		this.database.exec("PRAGMA journal_mode = WAL;");
		this.database.exec(SCHEMA_SQL);

		this.createJobStatement = this.database.prepare(`
			INSERT INTO scheduled_jobs (
				id,
				name,
				prompt,
				interval_ms,
				enabled,
				last_run_at,
				next_run_at,
				created_at,
				updated_at,
				run_count,
				max_catchup,
				last_error
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.getJobStatement = this.database.prepare(`
			SELECT
				id,
				name,
				prompt,
				interval_ms,
				enabled,
				last_run_at,
				next_run_at,
				created_at,
				updated_at,
				run_count,
				max_catchup,
				last_error
			FROM scheduled_jobs
			WHERE id = ?
		`);
		this.listEnabledJobsStatement = this.database.prepare(`
			SELECT
				id,
				name,
				prompt,
				interval_ms,
				enabled,
				last_run_at,
				next_run_at,
				created_at,
				updated_at,
				run_count,
				max_catchup,
				last_error
			FROM scheduled_jobs
			WHERE enabled = 1
			ORDER BY next_run_at ASC, created_at ASC
		`);
		this.listAllJobsStatement = this.database.prepare(`
			SELECT
				id,
				name,
				prompt,
				interval_ms,
				enabled,
				last_run_at,
				next_run_at,
				created_at,
				updated_at,
				run_count,
				max_catchup,
				last_error
			FROM scheduled_jobs
			ORDER BY created_at DESC, id DESC
		`);
		this.markJobRunStatement = this.database.prepare(`
			UPDATE scheduled_jobs
			SET
				last_run_at = ?,
				updated_at = ?,
				run_count = run_count + 1,
				last_error = ?
			WHERE id = ?
		`);
		this.updateJobIntervalStatement = this.database.prepare(`
			UPDATE scheduled_jobs
			SET
				interval_ms = ?,
				next_run_at = ?,
				updated_at = ?
			WHERE id = ?
		`);
		this.pauseJobStatement = this.database.prepare(`
			UPDATE scheduled_jobs
			SET
				enabled = 0,
				updated_at = ?
			WHERE id = ?
		`);
		this.resumeJobStatement = this.database.prepare(`
			UPDATE scheduled_jobs
			SET
				enabled = 1,
				next_run_at = ?,
				updated_at = ?
			WHERE id = ?
		`);
		this.updateNextRunStatement = this.database.prepare(`
			UPDATE scheduled_jobs
			SET
				next_run_at = ?,
				updated_at = ?
			WHERE id = ?
		`);
		this.setEnabledStatement = this.database.prepare(`
			UPDATE scheduled_jobs
			SET
				enabled = ?,
				updated_at = ?
			WHERE id = ?
		`);
		this.deleteJobStatement = this.database.prepare("DELETE FROM scheduled_jobs WHERE id = ?");

		logger.info("scheduled job store initialized", { dbPath });
	}

	create(input: CreateScheduledJobInput): ScheduledJob {
		const now = Date.now();
		const job: ScheduledJob = {
			id: randomUUID(),
			name: input.name,
			prompt: input.prompt,
			intervalMs: input.intervalMs,
			enabled: true,
			lastRunAt: null,
			nextRunAt: now + input.intervalMs,
			createdAt: now,
			updatedAt: now,
			runCount: 0,
			maxCatchup: input.maxCatchup ?? 1,
			lastError: null,
		};

		this.createJobStatement.run(
			job.id,
			job.name,
			job.prompt,
			job.intervalMs,
			1,
			null,
			job.nextRunAt,
			job.createdAt,
			job.updatedAt,
			job.runCount,
			job.maxCatchup,
			null,
		);

		return job;
	}

	getJob(jobId: string): ScheduledJob | null {
		const row = this.getJobStatement.get(jobId) as ScheduledJobRow | undefined;
		return row ? toScheduledJob(row) : null;
	}

	listEnabledJobs(): ScheduledJob[] {
		return (this.listEnabledJobsStatement.all() as ScheduledJobRow[]).map(toScheduledJob);
	}

	listAllJobs(): ScheduledJob[] {
		return (this.listAllJobsStatement.all() as ScheduledJobRow[]).map(toScheduledJob);
	}

	markJobRun(jobId: string, runAt: number, errorMessage?: string): void {
		this.markJobRunStatement.run(runAt, Date.now(), errorMessage ?? null, jobId);
	}

	updateInterval(jobId: string, intervalMs: number): ScheduledJob | null {
		const now = Date.now();
		this.updateJobIntervalStatement.run(intervalMs, now + intervalMs, now, jobId);
		return this.getJob(jobId);
	}

	pauseJob(jobId: string): ScheduledJob | null {
		this.pauseJobStatement.run(Date.now(), jobId);
		return this.getJob(jobId);
	}

	resumeJob(jobId: string): ScheduledJob | null {
		const currentJob = this.getJob(jobId);
		if (!currentJob) {
			return null;
		}

		const now = Date.now();
		this.resumeJobStatement.run(now + currentJob.intervalMs, now, jobId);
		return this.getJob(jobId);
	}

	updateNextRun(jobId: string, nextRunAt: number): void {
		this.updateNextRunStatement.run(nextRunAt, Date.now(), jobId);
	}

	setEnabled(jobId: string, enabled: boolean): void {
		this.setEnabledStatement.run(enabled ? 1 : 0, Date.now(), jobId);
	}

	deleteJob(jobId: string): void {
		this.deleteJobStatement.run(jobId);
	}
}
