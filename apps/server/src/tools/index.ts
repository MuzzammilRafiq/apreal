import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { JobStore, Scheduler } from "../scheduled-jobs/index.ts";
import { createDeleteScheduledJobTool } from "./delete-job.ts";
import { createListScheduledJobsTool } from "./list-jobs.ts";
import { createScheduleBackgroundJobTool } from "./schedule-job.ts";
import { webSearchTool } from "./web-search.ts";

export { webSearchTool } from "./web-search.ts";
export { createDeleteScheduledJobTool } from "./delete-job.ts";
export { createListScheduledJobsTool } from "./list-jobs.ts";
export { createScheduleBackgroundJobTool } from "./schedule-job.ts";

export function createCustomTools(
	store?: JobStore,
	scheduler?: Scheduler,
	extraTools: ToolDefinition[] = [],
): ToolDefinition[] {
	const tools: ToolDefinition[] = [webSearchTool, ...extraTools];
	if (!store || !scheduler) {
		return tools;
	}

	tools.push(
		createScheduleBackgroundJobTool(store, scheduler),
		createListScheduledJobsTool(store),
		createDeleteScheduledJobTool(store, scheduler),
	);
	return tools;
}
