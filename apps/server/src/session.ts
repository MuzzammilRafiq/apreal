import {
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import { createLogger, summarizePrompt } from "./logger.ts";

const OPENROUTER_PROVIDER = "openrouter";
const OPENROUTER_MINIMAX_MODEL_ID = "minimax/minimax-m2.5";
const OPENROUTER_ENV_VAR = "OPENROUTER_API_KEY";

export const BUILT_IN_TOOLS_LABEL = "read, bash, edit, write";

export type ToolExecutionStatus = "running" | "completed" | "failed";

export type ToolExecutionSummary = {
	id: string;
	name: string;
	summary: string;
	status: ToolExecutionStatus;
};

export type AgentStreamEvent =
	| { type: "text_delta"; delta: string }
	| { type: "thinking_delta"; delta: string }
	| {
			type: "message_end";
			body: string;
			thinking: string;
			toolCalls: ToolExecutionSummary[];
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
	readonly model: Model<"openai-completions">;
	isStreaming(): boolean;
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

export function formatModelLabel(model: Model<"openai-completions">): string {
	return `${model.provider}:${model.id}`;
}

function stringifyToolArguments(argumentsValue: unknown): string {
	if (typeof argumentsValue === "string") {
		return argumentsValue;
	}

	try {
		return JSON.stringify(argumentsValue);
	} catch {
		return String(argumentsValue);
	}
}

function truncateToolSummary(value: string, maxLength = 180): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "No arguments";
	}

	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	return null;
}

function readNumberField(record: Record<string, unknown>, keys: string[]): number | null {
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
		default: {
			if (path) {
				return truncateToolSummary(path);
			}

			return truncateToolSummary(stringifyToolArguments(record));
		}
	}
}

function extractAssistantMessageSnapshot(message: AssistantMessage): Extract<AgentStreamEvent, { type: "message_end" }> {
	let body = "";
	let thinking = "";
	const toolCalls: ToolExecutionSummary[] = [];

	for (const content of message.content) {
		switch (content.type) {
			case "text": {
				body += content.text;
				break;
			}
			case "thinking": {
				thinking += content.thinking;
				break;
			}
			case "toolCall": {
				toolCalls.push({
					id: content.id,
					name: content.name,
					summary: formatToolExecutionSummary(content.name, content.arguments),
					status: message.stopReason === "toolUse" ? "running" : "completed",
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
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
	};
}

function validateOpenRouterApiKey(rawValue: string | undefined): string | undefined {
	const value = rawValue?.trim();
	if (!value) {
		return value;
	}

	if (value.startsWith(`${OPENROUTER_ENV_VAR}=`)) {
		throw new Error(
			`Invalid OpenRouter API key format. Expected the raw token, but got a shell assignment string (${OPENROUTER_ENV_VAR}=...). Save only the token value in your environment or ~/.pi/agent/auth.json.`,
		);
	}

	return value;
}

type AgentControllerOptions = {
	sessionId?: string;
	transport?: string;
};

type OpenRouterRuntime = {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	model: Model<"openai-completions">;
};

let openRouterRuntimePromise: Promise<OpenRouterRuntime> | null = null;

function resolveOpenRouterModel(modelRegistry: ModelRegistry): Model<"openai-completions"> {
	const model = modelRegistry.find(OPENROUTER_PROVIDER, OPENROUTER_MINIMAX_MODEL_ID);
	if (!model) {
		throw new Error(`Configured OpenRouter model was not found in the registry: ${OPENROUTER_PROVIDER}/${OPENROUTER_MINIMAX_MODEL_ID}`);
	}

	if (model.api !== "openai-completions") {
		throw new Error(
			`Configured OpenRouter model uses unsupported API \"${model.api}\" for this server runtime: ${OPENROUTER_PROVIDER}/${OPENROUTER_MINIMAX_MODEL_ID}`,
		);
	}

	return model as Model<"openai-completions">;
}

async function getOpenRouterRuntime(): Promise<OpenRouterRuntime> {
	if (!openRouterRuntimePromise) {
		openRouterRuntimePromise = (async () => {
			const authStorage = AuthStorage.create();
			const runtimeApiKey = validateOpenRouterApiKey(process.env.OPENROUTER_API_KEY);
			if (runtimeApiKey) {
				authStorage.setRuntimeApiKey(OPENROUTER_PROVIDER, runtimeApiKey);
			}

			const modelRegistry = ModelRegistry.create(authStorage);
			const openRouterApiKey = validateOpenRouterApiKey(
				await modelRegistry.getApiKeyForProvider(OPENROUTER_PROVIDER),
			);
			if (!openRouterApiKey) {
				throw new Error(
					`Missing OpenRouter credentials. Set ${OPENROUTER_ENV_VAR} or add openrouter auth to ~/.pi/agent/auth.json.`,
				);
			}

			return {
				authStorage,
				modelRegistry,
				model: resolveOpenRouterModel(modelRegistry),
			};
		})();
	}

	try {
		return await openRouterRuntimePromise;
	} catch (error) {
		openRouterRuntimePromise = null;
		throw error;
	}
}

async function createOpenRouterSession(cwd: string) {
	const runtime = await getOpenRouterRuntime();
	const settingsManager = SettingsManager.inMemory({
		defaultProvider: OPENROUTER_PROVIDER,
		defaultModel: runtime.model.id,
	});

	const result = await createAgentSession({
		cwd,
		authStorage: runtime.authStorage,
		modelRegistry: runtime.modelRegistry,
		model: runtime.model,
		settingsManager,
		sessionManager: SessionManager.inMemory(),
	});

	return { ...result, model: runtime.model };
}

export async function prewarmAgentRuntime() {
	await getOpenRouterRuntime();
}

export async function createAgentController(
	cwd = process.cwd(),
	options?: AgentControllerOptions,
): Promise<AgentController> {
	const sessionId = options?.sessionId ?? crypto.randomUUID();
	const transport = options?.transport ?? "unknown";
	const logger = createLogger(`session:${sessionId}`);
	logger.info("creating agent session", { cwd, transport });

	const { session, model } = await createOpenRouterSession(cwd);
	const listeners = new Set<(event: AgentStreamEvent) => void>();
	let disposed = false;
	logger.info("agent session ready", { cwd, model: formatModelLabel(model), transport });

	const emit = (event: AgentStreamEvent) => {
		for (const listener of listeners) {
			listener(event);
		}
	};

	const unsubscribeSession = session.subscribe((event) => {
		switch (event.type) {
			case "message_end": {
				if (event.message.role !== "assistant") {
					break;
				}

				logger.info("assistant message ended", {
					stopReason: event.message.stopReason,
					errorMessage: event.message.errorMessage,
					hasText: event.message.content.some((content) => content.type === "text" && content.text.length > 0),
					hasThinking: event.message.content.some(
						(content) => content.type === "thinking" && content.thinking.length > 0,
					),
					toolCalls: event.message.content.filter((content) => content.type === "toolCall").length,
				});
				emit(extractAssistantMessageSnapshot(event.message));
				break;
			}
			case "message_update": {
				switch (event.assistantMessageEvent.type) {
					case "text_delta": {
						emit({
							type: "text_delta",
							delta: event.assistantMessageEvent.delta,
						});
						break;
					}
					case "thinking_delta": {
						emit({
							type: "thinking_delta",
							delta: event.assistantMessageEvent.delta,
						});
						break;
					}
					case "done": {
						logger.info("assistant response completed");
						emit({ type: "done" });
						break;
					}
					case "error": {
						logger.error("assistant response failed", {
							error: event.assistantMessageEvent.error.errorMessage ?? "Unknown error",
						});
						emit({
							type: "error",
							message: event.assistantMessageEvent.error.errorMessage ?? "Unknown error",
						});
						break;
					}
				}
				break;
			}
			case "tool_execution_start": {
				const tool = {
					id: event.toolCallId,
					name: event.toolName,
					summary: formatToolExecutionSummary(event.toolName, event.args),
					status: "running" as const,
				};

				logger.info("tool execution started", {
					tool: tool.name,
					summary: tool.summary,
				});
				emit({
					type: "tool_execution_start",
					tool,
				});
				break;
			}
			case "tool_execution_end": {
				logger.info("tool execution finished", {
					tool: event.toolName,
					toolCallId: event.toolCallId,
					failed: event.isError,
				});
				emit({
					type: "tool_execution_end",
					toolId: event.toolCallId,
					status: event.isError ? "failed" : "completed",
				});
				break;
			}
		}
	});

	return {
		sessionId,
		cwd,
		model,
		isStreaming: () => !disposed && session.isStreaming,
		prompt: async (input: string) => {
			if (disposed) {
				logger.warn("prompt rejected for disposed session");
				throw new Error("Agent session has already been disposed.");
			}

			const startedAt = performance.now();
			logger.info("prompt started", {
				chars: input.length,
				preview: summarizePrompt(input),
			});

			await session.prompt(input);
			logger.info("prompt finished", {
				durationMs: Math.round(performance.now() - startedAt),
			});
		},
		abort: async () => {
			if (disposed || !session.isStreaming) {
				logger.debug("abort ignored", {
					disposed,
					streaming: session.isStreaming,
				});
				return;
			}

			logger.warn("aborting active response");
			await session.abort();
		},
		dispose: () => {
			if (disposed) {
				logger.debug("dispose ignored");
				return;
			}

			disposed = true;
			logger.info("disposing session");
			listeners.clear();
			unsubscribeSession();
			session.dispose();
		},
		subscribe: (listener) => {
			if (disposed) {
				return () => {};
			}

			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}