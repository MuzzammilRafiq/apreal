import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { agentToolsConfig, getConfiguredToolNames, getConfiguredToolsLabel } from "./agent-tools.ts";
import { getAprealAgentDir, getAprealAgentPath } from "./agent-dir.ts";
import { createLogger, summarizePrompt } from "./logger.ts";
import { getDefaultMemoryStore } from "./memory-store.ts";
import type { ProvidersResponse } from "@apreal/shared";

const APREAL_AGENT_DIR = getAprealAgentDir();
const APREAL_AGENT_AUTH_PATH = getAprealAgentPath("auth.json");
const APREAL_AGENT_MODELS_PATH = getAprealAgentPath("models.json");
const APREAL_AGENT_SETTINGS_PATH = getAprealAgentPath("settings.json");
const PI_LOGIN_GUIDANCE =
	"Sign in from Apreal settings, then pick the default model for new chats.";
const LEGACY_ENV_CREDENTIAL_PROVIDERS: Record<string, string> = {
	ANTHROPIC_API_KEY: "anthropic",
	AZURE_OPENAI_API_KEY: "azure-openai-responses",
	CEREBRAS_API_KEY: "cerebras",
	GEMINI_API_KEY: "google",
	GROQ_API_KEY: "groq",
	HF_TOKEN: "huggingface",
	KIMI_API_KEY: "kimi-coding",
	MINIMAX_API_KEY: "minimax",
	MINIMAX_CN_API_KEY: "minimax-cn",
	MISTRAL_API_KEY: "mistral",
	OPENAI_API_KEY: "openai",
	OPENROUTER_API_KEY: "openrouter",
	OPENCODE_API_KEY: "opencode",
	XAI_API_KEY: "xai",
	ZAI_API_KEY: "zai",
};

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

function buildAgentModelInfo(
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
		case "memory": {
			const action = readStringField(record, ["action"]);
			const memoryType = readStringField(record, ["memoryType"]);
			const query = readStringField(record, ["query"]);
			const memoryId = readStringField(record, ["memoryId", "id"]);
			if (action === "search" && query) {
				return truncateToolSummary(`${action}: ${query}`);
			}
			if (action && memoryType) {
				return truncateToolSummary(`${action}: ${memoryType}`);
			}
			if (action && memoryId) {
				return truncateToolSummary(`${action}: ${memoryId}`);
			}
			if (action) {
				return truncateToolSummary(action);
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

type AgentControllerOptions = {
	sessionId?: string;
	transport?: string;
	customTools?: ToolDefinition[];
};

type PiRuntime = {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
};

function normalizeCredentialProviderId(providerId: string): string {
	return LEGACY_ENV_CREDENTIAL_PROVIDERS[providerId] ?? providerId;
}

function applyLegacyEnvCredentialAliases(authStorage: AuthStorage) {
	for (const [envVar, provider] of Object.entries(LEGACY_ENV_CREDENTIAL_PROVIDERS)) {
		if (authStorage.hasAuth(provider)) {
			continue;
		}

		const credential = authStorage.get(envVar);
		if (credential?.type === "api_key") {
			authStorage.setRuntimeApiKey(provider, credential.key);
		}
	}
}

function getMissingAuthError() {
	return [
		"No Apreal model credentials are configured for the local server.",
		PI_LOGIN_GUIDANCE,
		`Apreal auth is read from ${APREAL_AGENT_AUTH_PATH} and defaults from ${APREAL_AGENT_SETTINGS_PATH}.`,
	].join(" ");
}

async function createResourceLoader(cwd: string, settingsManager: SettingsManager) {
	const memoryStore = getDefaultMemoryStore();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: APREAL_AGENT_DIR,
		settingsManager,
		agentsFilesOverride: (base) => {
			const persistentMemory = memoryStore.renderAlwaysLoadedContext();
			if (!persistentMemory) {
				return base;
			}

			return {
				agentsFiles: [
					...base.agentsFiles.filter((file) => file.path !== persistentMemory.path),
					persistentMemory,
				],
			};
		},
		appendSystemPromptOverride: (base) => [
			...base,
			[
				"## Persistent Memory Tool",
				"- Use the `memory` tool when the user asks you to remember, read, update, or forget durable information.",
				"- Save durable facts as small, granular memory items grouped inside memory blocks.",
				"- Give each memory item a short description and prefer granular items; split oversized content into multiple items when practical.",
				"- `always` memories only load compact summaries into future turns; read full item content on demand with the tool.",
			].join("\n"),
		],
	});
	await resourceLoader.reload();
	return resourceLoader;
}

function createPiRuntime(cwd: string): PiRuntime {
	const authStorage = AuthStorage.create(APREAL_AGENT_AUTH_PATH);
	applyLegacyEnvCredentialAliases(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage, APREAL_AGENT_MODELS_PATH);
	const settingsManager = SettingsManager.create(cwd, APREAL_AGENT_DIR);

	if (modelRegistry.getAvailable().length === 0) {
		throw new Error(getMissingAuthError());
	}

	return {
		authStorage,
		modelRegistry,
		settingsManager,
	};
}

async function createPiSession(cwd: string, customTools: ToolDefinition[] = agentToolsConfig.customTools) {
	const runtime = createPiRuntime(cwd);
	const resourceLoader = await createResourceLoader(cwd, runtime.settingsManager);
	const result = await createAgentSession({
		cwd,
		agentDir: APREAL_AGENT_DIR,
		authStorage: runtime.authStorage,
		modelRegistry: runtime.modelRegistry,
		resourceLoader,
		settingsManager: runtime.settingsManager,
		sessionManager: SessionManager.inMemory(),
		tools: getConfiguredToolNames(customTools),
		customTools,
	});
	const model = result.session.model;
	if (!model) {
		const configuredProvider = runtime.settingsManager.getDefaultProvider();
		const configuredModel = runtime.settingsManager.getDefaultModel();
		const configuredReference = configuredProvider && configuredModel
			? `${configuredProvider}/${configuredModel}`
			: null;
		throw new Error(
			configuredReference
				? `The configured Pi default model (${configuredReference}) could not be resolved for this server. Open \`pi\` and pick a valid default with \`/model\`.`
				: getMissingAuthError(),
		);
	}

	return {
		...result,
		model,
		modelInfo: buildAgentModelInfo(model, runtime.modelRegistry),
	};
}

export async function prewarmAgentRuntime(cwd = process.cwd()) {
	createPiRuntime(cwd);
}

export async function createAgentController(
	cwd = process.cwd(),
	options?: AgentControllerOptions,
): Promise<AgentController> {
	const sessionId = options?.sessionId ?? crypto.randomUUID();
	const transport = options?.transport ?? "unknown";
	const logger = createLogger(`session:${sessionId}`);
	logger.info("creating agent session", { cwd, transport });

	const { session, model, modelInfo } = await createPiSession(cwd, options?.customTools);
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
			case "message_start": {
				if (event.message.role !== "assistant") {
					break;
				}

				emit({ type: "assistant_message_start" });
				break;
			}
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
							contentIndex: event.assistantMessageEvent.contentIndex,
						});
						break;
					}
					case "thinking_delta": {
						emit({
							type: "thinking_delta",
							delta: event.assistantMessageEvent.delta,
							contentIndex: event.assistantMessageEvent.contentIndex,
						});
						break;
					}
					case "toolcall_end": {
						const tool = {
							id: event.assistantMessageEvent.toolCall.id,
							name: event.assistantMessageEvent.toolCall.name,
							summary: formatToolExecutionSummary(
								event.assistantMessageEvent.toolCall.name,
								event.assistantMessageEvent.toolCall.arguments,
							),
							status: "running" as const,
						} satisfies ToolExecutionSummary;
						emit({
							type: "tool_call",
							tool,
							contentIndex: event.assistantMessageEvent.contentIndex,
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
		modelInfo,
		isStreaming: () => !disposed && session.isStreaming,
		getContextUsage: () => {
			if (disposed) {
				return undefined;
			}

			const usage = session.getContextUsage();
			if (!usage) {
				return undefined;
			}

			return {
				tokens: usage.tokens ?? null,
				contextWindow: usage.contextWindow,
				percent: usage.percent ?? null,
			};
		},
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

			await session.reload();
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

function buildProvidersPayloadFromRuntime(runtime: PiRuntime): ProvidersResponse {
	const availableModels = [...runtime.modelRegistry.getAvailable()].sort((left, right) =>
		left.provider.localeCompare(right.provider) ||
		left.name.localeCompare(right.name) ||
		left.id.localeCompare(right.id),
	);
	const modelsByProvider = new Map<string, { id: string; name: string }[]>();

	for (const model of availableModels) {
		const providerId = String(model.provider);
		const bucket = modelsByProvider.get(providerId) ?? [];
		bucket.push({ id: model.id, name: model.name });
		modelsByProvider.set(providerId, bucket);
	}

	const configuredProviderIds = [...new Set(runtime.authStorage.list().map(normalizeCredentialProviderId))];
	const providers = configuredProviderIds.map((id) => {
		const credential = runtime.authStorage.get(id);
		return {
			id,
			authType: (credential?.type ?? "api_key") as "oauth" | "api_key",
			models: modelsByProvider.get(id) ?? [],
		};
	});

	for (const [providerId, models] of modelsByProvider) {
		if (!configuredProviderIds.includes(providerId)) {
			providers.push({ id: providerId, authType: "api_key", models });
		}
	}

	providers.sort((left, right) => left.id.localeCompare(right.id));

	return {
		providers,
		defaultProvider: runtime.settingsManager.getDefaultProvider() ?? null,
		defaultModel: runtime.settingsManager.getDefaultModel() ?? null,
	};
}

export function buildProvidersPayload(cwd: string): ProvidersResponse {
	const authStorage = AuthStorage.create(APREAL_AGENT_AUTH_PATH);
	applyLegacyEnvCredentialAliases(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage, APREAL_AGENT_MODELS_PATH);
	const settingsManager = SettingsManager.create(cwd, APREAL_AGENT_DIR);

	return buildProvidersPayloadFromRuntime({
		authStorage,
		modelRegistry,
		settingsManager,
	});
}

export async function setDefaultProviderModel(
	cwd: string,
	provider: string,
	modelId: string,
): Promise<ProvidersResponse> {
	const authStorage = AuthStorage.create(APREAL_AGENT_AUTH_PATH);
	applyLegacyEnvCredentialAliases(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage, APREAL_AGENT_MODELS_PATH);
	const settingsManager = SettingsManager.create(cwd, APREAL_AGENT_DIR);
	const availableModel = modelRegistry.getAvailable().find((model) =>
		String(model.provider) === provider && model.id === modelId
	);

	if (!availableModel) {
		throw new Error(`The selected model (${provider}/${modelId}) is not available for this server.`);
	}

	settingsManager.setDefaultModelAndProvider(provider, modelId);
	await settingsManager.flush();

	return buildProvidersPayloadFromRuntime({
		authStorage,
		modelRegistry,
		settingsManager,
	});
}
