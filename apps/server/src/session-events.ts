import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getConfiguredToolsLabel } from "./agent-tools.ts";

export const BUILT_IN_TOOLS_LABEL = getConfiguredToolsLabel();

export type ToolExecutionStatus = "running" | "completed" | "failed";

export type ToolExecutionSummary = {
	id: string;
	name: string;
	summary: string;
	status: ToolExecutionStatus;
};

export type AgentTextSegment = {
	type: "text";
	content: string;
	contentIndex: number;
};

export type AgentThinkingSegment = {
	type: "thinking";
	content: string;
	contentIndex: number;
};

export type AgentToolCallSegment = ToolExecutionSummary & {
	type: "tool_call";
	contentIndex: number;
};

export type AgentMessageSegment = AgentTextSegment | AgentThinkingSegment | AgentToolCallSegment;

export type AgentContextUsage = {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
};

export type AgentModelInfo = {
	modelLabel: string;
	modelSource: string;
};

export type AgentStreamEvent =
	| { type: "assistant_message_start" }
	| { type: "text_delta"; delta: string; contentIndex: number }
	| { type: "thinking_delta"; delta: string; contentIndex: number }
	| { type: "tool_call"; tool: ToolExecutionSummary; contentIndex: number }
	| {
			type: "message_end";
			body: string;
			thinking: string;
			toolCalls: ToolExecutionSummary[];
			segments: AgentMessageSegment[];
			stopReason: AssistantMessage["stopReason"];
			errorMessage?: string;
	  }
	| { type: "tool_execution_start"; tool: ToolExecutionSummary }
	| { type: "tool_execution_end"; toolId: string; status: Exclude<ToolExecutionStatus, "running"> }
	| { type: "done" }
	| { type: "error"; message: string };

export interface AgentController {
	readonly sessionId: string;
	readonly cwd: string;
	readonly model: Model<Api>;
	readonly modelInfo: AgentModelInfo;
	isStreaming(): boolean;
	getContextUsage(): AgentContextUsage | undefined;
	setModel(provider: string, modelId: string): Promise<void>;
	prompt(input: string): Promise<void>;
	abort(): Promise<void>;
	dispose(): void;
	subscribe(listener: (event: AgentStreamEvent) => void): () => void;
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

export function formatModelLabel(model: Model<Api>): string {
	return `${model.provider}:${model.id}`;
}

export function buildAgentModelInfo(
	model: Model<Api>,
	modelRegistry: ModelRegistry,
): AgentModelInfo {
	const providerLabel = modelRegistry.getProviderDisplayName(model.provider);
	const authTypeLabel = modelRegistry.isUsingOAuth(model) ? "Subscription" : "API key";

	return {
		modelLabel: model.name,
		modelSource: `${model.id} · ${providerLabel} · ${authTypeLabel}`,
	};
}

export function stringifyToolArguments(argumentsValue: unknown): string {
	if (typeof argumentsValue === "string") {
		return argumentsValue;
	}

	try {
		return JSON.stringify(argumentsValue);
	} catch {
		return String(argumentsValue);
	}
}

export function truncateToolSummary(value: string, maxLength = 180): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "No arguments";
	}

	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function readStringField(record: Record<string, unknown>, keys: string[]): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	return null;
}

export function readNumberField(record: Record<string, unknown>, keys: string[]): number | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}

	return null;
}

export function formatToolExecutionSummary(name: string, args: unknown): string {
	const normalizedName = name.trim().toLowerCase();
	if (!args || typeof args !== "object") {
		return truncateToolSummary(stringifyToolArguments(args));
	}

	const record = args as Record<string, unknown>;
	const path = readStringField(record, ["filePath", "path", "targetPath", "directory", "dirPath", "cwd"]);

	switch (normalizedName) {
		case "bash": {
			return truncateToolSummary(readStringField(record, ["command"]) ?? stringifyToolArguments(record));
		}
		case "read": {
			const startLine = readNumberField(record, ["startLine", "start", "fromLine"]);
			const endLine = readNumberField(record, ["endLine", "end", "toLine"]);
			const location = path ?? readStringField(record, ["file", "target"]);
			if (!location) {
				return truncateToolSummary(stringifyToolArguments(record));
			}

			if (startLine !== null && endLine !== null) {
				return `${truncateToolSummary(location, 120)}:${startLine}-${endLine}`;
			}

			return truncateToolSummary(location);
		}
		case "edit":
		case "write":
		case "find":
		case "ls": {
			if (path) {
				return truncateToolSummary(path);
			}

			return truncateToolSummary(stringifyToolArguments(record));
		}
		case "grep": {
			const query = readStringField(record, ["pattern", "query", "search"]);
			if (query && path) {
				return truncateToolSummary(`${query} in ${path}`);
			}
			if (query) {
				return truncateToolSummary(query);
			}
			if (path) {
				return truncateToolSummary(path);
			}

			return truncateToolSummary(stringifyToolArguments(record));
		}
		case "memory": {
			const action = readStringField(record, ["action"]);
			const memoryType = readStringField(record, ["memoryType"]);
			const fileName = readStringField(record, ["fileName", "file", "path"]);
			if (action && memoryType && fileName) {
				return truncateToolSummary(`${action}: ${memoryType}/${fileName}`);
			}
			if (action && memoryType) {
				return truncateToolSummary(`${action}: ${memoryType}`);
			}
			if (action) {
				return truncateToolSummary(action);
			}

			return truncateToolSummary(stringifyToolArguments(record));
		}
		case "skills_list": {
			const query = readStringField(record, ["query"]);
			const source = readStringField(record, ["source"]);
			if (query && source) {
				return truncateToolSummary(`${query} in ${source} skills`);
			}
			return truncateToolSummary(query ?? source ?? "all skills");
		}
		case "skill_view": {
			const skillName = readStringField(record, ["name"]);
			const filePath = readStringField(record, ["filePath", "file", "path"]);
			if (skillName && filePath) {
				return truncateToolSummary(`${skillName}: ${filePath}`);
			}
			return truncateToolSummary(skillName ?? stringifyToolArguments(record));
		}
		case "skill_manage": {
			const action = readStringField(record, ["action"]);
			const skillName = readStringField(record, ["name"]);
			const filePath = readStringField(record, ["filePath", "file", "path"]);
			if (action && skillName && filePath) {
				return truncateToolSummary(`${action}: ${skillName}/${filePath}`);
			}
			if (action && skillName) {
				return truncateToolSummary(`${action}: ${skillName}`);
			}
			return truncateToolSummary(action ?? skillName ?? stringifyToolArguments(record));
		}
		default: {
			if (path) {
				return truncateToolSummary(path);
			}

			return truncateToolSummary(stringifyToolArguments(record));
		}
	}
}

export function extractAssistantMessageSnapshot(message: AssistantMessage): Extract<AgentStreamEvent, { type: "message_end" }> {
	let body = "";
	let thinking = "";
	const toolCalls: ToolExecutionSummary[] = [];
	const segments: AgentMessageSegment[] = [];

	for (const [contentIndex, content] of message.content.entries()) {
		switch (content.type) {
			case "text": {
				body += content.text;
				segments.push({
					type: "text",
					content: content.text,
					contentIndex,
				});
				break;
			}
			case "thinking": {
				thinking += content.thinking;
				segments.push({
					type: "thinking",
					content: content.thinking,
					contentIndex,
				});
				break;
			}
			case "toolCall": {
				const toolCall = {
					id: content.id,
					name: content.name,
					summary: formatToolExecutionSummary(content.name, content.arguments),
					status: (message.stopReason === "toolUse" ? "running" : "completed") as ToolExecutionStatus,
				} satisfies ToolExecutionSummary;
				toolCalls.push(toolCall);
				segments.push({
					...toolCall,
					type: "tool_call",
					contentIndex,
				});
				break;
			}
		}
	}

	return {
		type: "message_end",
		body,
		thinking,
		toolCalls,
		segments,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
	};
}
