import { Type, type Static } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { JobStore, Scheduler } from "../scheduled-jobs/index.ts";

const deleteScheduledJobParameters = Type.Object({
	jobId: Type.String({ description: "The scheduled job id." }),
	action: Type.Union([
		Type.Literal("pause"),
		Type.Literal("resume"),
		Type.Literal("delete"),
	]),
});

type DeleteScheduledJobParams = Static<typeof deleteScheduledJobParameters>;

export function createDeleteScheduledJobTool(store: JobStore, scheduler: Scheduler) {
	return defineTool({
		name: "delete_scheduled_job",
		label: "Delete Scheduled Job",
		description: "Pauses, resumes, or deletes an existing scheduled background job.",
		parameters: deleteScheduledJobParameters as any,
		async execute(_toolCallId, params: DeleteScheduledJobParams) {
			const existingJob = store.getJob(params.jobId);
			if (!existingJob) {
				throw new Error(`Scheduled job not found: ${params.jobId}`);
			}

			switch (params.action) {
				case "pause": {
					store.setEnabled(params.jobId, false);
					await scheduler.reschedule(params.jobId);
					break;
				}
				case "resume": {
					store.setEnabled(params.jobId, true);
					const job = store.getJob(params.jobId);
					if (!job) {
						throw new Error(`Scheduled job not found after resume: ${params.jobId}`);
					}
					scheduler.scheduleJob(job);
					break;
				}
				case "delete": {
					store.deleteJob(params.jobId);
					await scheduler.reschedule(params.jobId);
					break;
				}
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								ok: true,
								action: params.action,
								jobId: params.jobId,
							},
							null,
							2,
						),
					},
				],
				details: {
					action: params.action,
					jobId: params.jobId,
				},
			};
		},
	});
}