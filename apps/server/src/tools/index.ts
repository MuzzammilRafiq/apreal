import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { JobStore, Scheduler } from "../scheduled-jobs/index.ts";
import { getDefaultFileMemoryStore } from "../file-memory-store.ts";
import { createDeleteScheduledJobTool } from "./delete-job.ts";
import { createListScheduledJobsTool } from "./list-jobs.ts";
import { createMemoryTool } from "./memory.ts";
import { createScheduleBackgroundJobTool } from "./schedule-job.ts";
import { createSkillTools } from "./skills.ts";
import { webSearchTool } from "./web-search.ts";

export { webSearchTool } from "./web-search.ts";
export { createDeleteScheduledJobTool } from "./delete-job.ts";
export { createListScheduledJobsTool } from "./list-jobs.ts";
export { createMemoryTool } from "./memory.ts";
export { createScheduleBackgroundJobTool } from "./schedule-job.ts";
export { createSkillTools } from "./skills.ts";

export function createCustomTools(
	store?: JobStore,
	scheduler?: Scheduler,
	extraTools: ToolDefinition[] = [],
	cwd = process.cwd(),
): ToolDefinition[] {
	const tools: ToolDefinition[] = [
		webSearchTool,
		createMemoryTool(getDefaultFileMemoryStore()),
		...createSkillTools(cwd),
		...extraTools,
	];
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
