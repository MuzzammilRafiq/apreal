import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { customTools } from "./tools/index.ts";

// Built-in Pi tools you can enable in agentToolsConfig.builtInTools.
export type BuiltInToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";

export const BUILT_IN_TOOL_PRESETS = {
	readonly: ["read", "grep", "find", "ls"],
	coding: ["read", "bash", "edit", "write"],
	extendedCoding: ["read", "bash", "edit", "write", "grep", "find", "ls"],
} as const satisfies Record<string, readonly BuiltInToolName[]>;

export type AgentToolsConfig = {
	builtInTools: BuiltInToolName[];
	customTools: ToolDefinition[];
};

export const agentToolsConfig: AgentToolsConfig = {
	// Pick any built-in Pi tools you want the agent to be able to call.
	builtInTools: [...BUILT_IN_TOOL_PRESETS.extendedCoding],
	customTools,
};

function createBuiltInTool(toolName: BuiltInToolName, cwd: string) {
	switch (toolName) {
		case "read":
			return createReadTool(cwd);
		case "bash":
			return createBashTool(cwd);
		case "edit":
			return createEditTool(cwd);
		case "write":
			return createWriteTool(cwd);
		case "grep":
			return createGrepTool(cwd);
		case "find":
			return createFindTool(cwd);
		case "ls":
			return createLsTool(cwd);
	}
}

export function createConfiguredBuiltInTools(cwd: string) {
	return agentToolsConfig.builtInTools.map((toolName) => createBuiltInTool(toolName, cwd));
}

export function getConfiguredToolNames(): string[] {
	return [...agentToolsConfig.builtInTools, ...agentToolsConfig.customTools.map((tool) => tool.name)];
}

export function getConfiguredToolsLabel(): string {
	const names = getConfiguredToolNames();
	return names.length > 0 ? names.join(", ") : "No tools enabled";
}