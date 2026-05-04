import { Type, type Static } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { JobStore, Scheduler } from "../scheduled-jobs/index.ts";

const scheduleBackgroundJobParameters = Type.Object({
	name: Type.String({ description: "Short name for the recurring background job." }),
	prompt: Type.String({ description: "Prompt the agent should run each time the job fires." }),
	intervalMinutes: Type.Number({
		description: "Recurring interval in minutes. Must be at least 5 minutes.",
		minimum: 5,
	}),
});

type ScheduleBackgroundJobParams = Static<typeof scheduleBackgroundJobParameters>;

export function createScheduleBackgroundJobTool(store: JobStore, scheduler: Scheduler) {
	return defineTool({
		name: "schedule_background_job",
		label: "Schedule Background Job",
		description:
			"Creates a recurring background job that will run the saved prompt on a schedule. ONLY create this when the user explicitly asks for scheduled, recurring, repeated, or reminder-like behavior. Do NOT create it for one-time requests.",
		parameters: scheduleBackgroundJobParameters as any,
		async execute(_toolCallId, params: ScheduleBackgroundJobParams) {
			if (params.intervalMinutes < 5) {
				throw new Error("Scheduled jobs must run at intervals of at least 5 minutes.");
			}

			const job = store.create({
				name: params.name.trim(),
				prompt: params.prompt.trim(),
				intervalMs: Math.round(params.intervalMinutes * 60_000),
			});
			scheduler.scheduleJob(job);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								ok: true,
								job: {
									id: job.id,
									name: job.name,
									prompt: job.prompt,
									intervalMinutes: params.intervalMinutes,
									nextRunAt: new Date(job.nextRunAt).toISOString(),
								},
							},
							null,
							2,
						),
					},
				],
				details: {
					jobId: job.id,
					intervalMinutes: params.intervalMinutes,
					nextRunAt: job.nextRunAt,
				},
			};
		},
	});
}