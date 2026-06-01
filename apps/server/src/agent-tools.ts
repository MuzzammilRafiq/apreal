import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AvailableTool } from "@apreal/shared";
import { createCustomTools } from "./tools/index.ts";

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

const BUILT_IN_TOOL_DESCRIPTIONS: Record<BuiltInToolName, string> = {
	read: "Reads file contents from the workspace.",
	bash: "Runs shell commands inside the workspace.",
	edit: "Applies targeted edits to existing files.",
	write: "Creates or overwrites files in the workspace.",
	grep: "Searches file contents with pattern matching.",
	find: "Finds files and directories by name or path.",
	ls: "Lists files and directories in the workspace.",
};

const defaultCustomTools = createCustomTools();

export const agentToolsConfig: AgentToolsConfig = {
	// Pick any built-in Pi tools you want the agent to be able to call.
	builtInTools: [...BUILT_IN_TOOL_PRESETS.extendedCoding],
	customTools: defaultCustomTools,
};

export function getConfiguredBuiltInToolNames() {
	return [...agentToolsConfig.builtInTools];
}

export function getConfiguredToolNames(customTools: ToolDefinition[] = agentToolsConfig.customTools): string[] {
	return [...agentToolsConfig.builtInTools, ...customTools.map((tool) => tool.name)];
}

export function getConfiguredToolsLabel(customTools: ToolDefinition[] = agentToolsConfig.customTools): string {
	const names = getConfiguredToolNames(customTools);
	return names.length > 0 ? names.join(", ") : "No tools enabled";
}

export function getConfiguredToolInventory(customTools: ToolDefinition[] = agentToolsConfig.customTools): AvailableTool[] {
	const builtInTools: AvailableTool[] = agentToolsConfig.builtInTools.map((toolName) => ({
		name: toolName,
		label: toolName,
		description: BUILT_IN_TOOL_DESCRIPTIONS[toolName],
		kind: "built_in",
	}));
	const customToolEntries: AvailableTool[] = customTools.map((tool) => ({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		kind: "custom",
	}));

	return [...builtInTools, ...customToolEntries];
}
