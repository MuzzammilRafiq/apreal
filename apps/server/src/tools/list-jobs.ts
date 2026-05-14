import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { JobStore } from "../scheduled-jobs/index.ts";

function formatTimestamp(value: number | null): string | null {
	return value === null ? null : new Date(value).toISOString();
}

export function createListScheduledJobsTool(store: JobStore) {
	return defineTool({
		name: "list_scheduled_jobs",
		label: "List Scheduled Jobs",
		description: "Lists all scheduled background jobs, including paused jobs and their next run times.",
		parameters: Type.Object({}) as any,
		async execute() {
			const jobs = store.listAllJobs();

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								count: jobs.length,
								jobs: jobs.map((job) => ({
									id: job.id,
									name: job.name,
									enabled: job.enabled,
									intervalMs: job.intervalMs,
									runCount: job.runCount,
									createdAt: formatTimestamp(job.createdAt),
									updatedAt: formatTimestamp(job.updatedAt),
									lastRunAt: formatTimestamp(job.lastRunAt),
									nextRunAt: formatTimestamp(job.nextRunAt),
									lastError: job.lastError,
								})),
							},
							null,
							2,
						),
					},
				],
				details: {
					count: jobs.length,
				},
			};
		},
	});
}