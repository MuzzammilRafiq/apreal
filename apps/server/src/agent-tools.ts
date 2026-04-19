import { Type } from "@mariozechner/pi-ai";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	defineTool,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

// Built-in Pi tools you can enable in agentToolsConfig.builtInTools.
export type BuiltInToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";

export const BUILT_IN_TOOL_PRESETS = {
	readonly: ["read", "grep", "find", "ls"],
	coding: ["read", "bash", "edit", "write"],
	extendedCoding: ["read", "bash", "edit", "write", "grep", "find", "ls"],
} as const satisfies Record<string, readonly BuiltInToolName[]>;

// Example 1: a zero-argument tool.
// Structure:
// - name: the tool call name the model sees
// - label: a UI-friendly label
// - description: instruction for when the model should use it
// - parameters: JSON schema for inputs
// - execute: returns content shown back to the model
export const currentTimeToolExample = defineTool({
	name: "current_time",
	label: "Current Time",
	description: "Returns the current server time in ISO-8601 format.",
	parameters: Type.Object({}),
	async execute() {
		return {
			content: [{ type: "text", text: new Date().toISOString() }],
			details: {},
		};
	},
});

// Example 2: a parameterized tool.
// This is a good template when you want the model to pass structured input.
export const echoNoteToolExample = defineTool({
	name: "echo_note",
	label: "Echo Note",
	description: "Formats a short note from structured input and returns it as plain text.",
	parameters: Type.Object({
		title: Type.String({ description: "Short heading for the note" }),
		message: Type.String({ description: "Main note body" }),
		uppercase: Type.Optional(Type.Boolean({ description: "Whether to uppercase the final note" })),
	}),
	async execute(_toolCallId, params) {
		const note = `${params.title}: ${params.message}`;
		const text = params.uppercase ? note.toUpperCase() : note;

		return {
			content: [{ type: "text", text }],
			details: {
				title: params.title,
				uppercase: params.uppercase ?? false,
			},
		};
	},
});

export type AgentToolsConfig = {
	builtInTools: BuiltInToolName[];
	customTools: ToolDefinition[];
};

export const agentToolsConfig: AgentToolsConfig = {
	// Pick any built-in Pi tools you want the agent to be able to call.
	builtInTools: [...BUILT_IN_TOOL_PRESETS.coding],
	customTools: [
		// Add your custom ToolDefinitions here.
		// Example:
		// currentTimeToolExample,
		// echoNoteToolExample,
	],
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