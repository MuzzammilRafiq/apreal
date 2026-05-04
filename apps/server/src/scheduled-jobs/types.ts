export interface ScheduledJob {
	id: string;
	name: string;
	prompt: string;
	intervalMs: number;
	enabled: boolean;
	lastRunAt: number | null;
	nextRunAt: number;
	createdAt: number;
	updatedAt: number;
	runCount: number;
	maxCatchup: number;
	lastError: string | null;
}

export interface CreateScheduledJobInput {
	name: string;
	prompt: string;
	intervalMs: number;
	maxCatchup?: number;
}