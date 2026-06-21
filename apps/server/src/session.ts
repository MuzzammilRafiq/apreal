import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getProviders, type Api, type AssistantMessage, type Message, type Model } from "@earendil-works/pi-ai";
import { agentToolsConfig, getConfiguredToolNames } from "./agent-tools.ts";
import { getAprealAgentDir, getAprealAgentPath } from "./agent-dir.ts";
import { getDefaultFileMemoryStore } from "./file-memory-store.ts";
import { createLogger, summarizePrompt } from "./logger.ts";
import type { AvailableSkill, ProviderLoginState, ProvidersResponse } from "@apreal/shared";

const APREAL_AGENT_DIR = getAprealAgentDir();
const APREAL_AGENT_AUTH_PATH = getAprealAgentPath("auth.json");
const APREAL_AGENT_MODELS_PATH = getAprealAgentPath("models.json");
const APREAL_AGENT_SETTINGS_PATH = getAprealAgentPath("settings.json");
const MEMORY_REVIEW_NUDGE_INTERVAL = 10;
process.env.PI_CODING_AGENT_DIR ??= APREAL_AGENT_DIR;
process.env.PI_CODING_AGENT_SESSION_DIR ??= getAprealAgentPath("sessions");
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

import { BUILT_IN_TOOLS_LABEL, getErrorMessage, formatModelLabel, buildAgentModelInfo, stringifyToolArguments, truncateToolSummary, readStringField, readNumberField, formatToolExecutionSummary, extractAssistantMessageSnapshot, type ToolExecutionStatus, type ToolExecutionSummary, type AgentTextSegment, type AgentThinkingSegment, type AgentToolCallSegment, type AgentMessageSegment, type AgentContextUsage, type AgentModelInfo, type AgentStreamEvent, type AgentController } from "./session-events.ts";
export { BUILT_IN_TOOLS_LABEL, getErrorMessage, formatModelLabel, buildAgentModelInfo, stringifyToolArguments, truncateToolSummary, readStringField, readNumberField, formatToolExecutionSummary, extractAssistantMessageSnapshot } from "./session-events.ts";
export type { ToolExecutionStatus, ToolExecutionSummary, AgentTextSegment, AgentThinkingSegment, AgentToolCallSegment, AgentMessageSegment, AgentContextUsage, AgentModelInfo, AgentStreamEvent, AgentController } from "./session-events.ts";
type AgentControllerOptions = {
	sessionId?: string;
	transport?: string;
	customTools?: ToolDefinition[];
	history?: AgentHistoryMessage[];
};

export type AgentHistoryMessage = {
	role: "user" | "assistant";
	body: string;
	createdAt: number;
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
	const memoryStore = getDefaultFileMemoryStore();
	const memorySnapshot = memoryStore.createPromptSnapshot();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: APREAL_AGENT_DIR,
		settingsManager,
		agentsFilesOverride: (base) => {
			const memoryFiles = memoryStore.renderPromptContexts(memorySnapshot);
			if (memoryFiles.length === 0) {
				return base;
			}

			const memoryPaths = new Set(memoryFiles.map((file) => file.path));
			return {
				agentsFiles: [
					...base.agentsFiles.filter((file) => !memoryPaths.has(file.path)),
					...memoryFiles,
				],
			};
		},
		appendSystemPromptOverride: (base) => [
			...base,
			[
				"## Persistent Memory",
				"- Use the memory tool when the user asks you to remember, read, update, or forget durable information.",
				"- Prefer user memory for stable facts about the user: preferences, communication style, expectations, and personal workflow.",
				"- Prefer agent memory for stable facts about Apreal, projects, environment quirks, tool behavior, and decisions that should survive sessions.",
				"- Use memory(action=add, memoryType=user or agent, content=...) for new durable entries.",
				"- Use memory(action=replace or remove, memoryType=user or agent, match=...) to keep entries compact and current.",
				"- Memory files are loaded as a frozen snapshot when the session is created. Tool writes are durable immediately, but the prompt snapshot refreshes in the next session.",
				"- Legacy always memory and topic search memory still exist; only the search memory index is loaded by default, so read search files on demand when relevant.",
			].join("\n"),
		],
	});
	await resourceLoader.reload();
	return resourceLoader;
}

export function shouldNudgeMemoryReview(userTurnCount: number): boolean {
	return MEMORY_REVIEW_NUDGE_INTERVAL > 0 && userTurnCount > 0 && userTurnCount % MEMORY_REVIEW_NUDGE_INTERVAL === 0;
}

function appendMemoryReviewNudge(input: string): string {
	return [
		input,
		"",
		"<apreal_memory_review_nudge>",
		"After you finish the user's request, quietly review whether this conversation revealed durable user preferences, expectations, project decisions, environment facts, or workflow quirks worth saving. If so, use the memory tool to add or update user or agent memory. If nothing is worth saving, do nothing and do not mention this nudge.",
		"</apreal_memory_review_nudge>",
	].join("\n");
}

function getAvailableSkillSource(
	sourceInfo: { scope: "user" | "project" | "temporary"; origin: "package" | "top-level" },
): AvailableSkill["source"] {
	if (sourceInfo.origin === "package") {
		return "extension";
	}
	if (sourceInfo.scope === "project") {
		return "project";
	}
	if (sourceInfo.scope === "user") {
		return "user";
	}
	if (sourceInfo.scope === "temporary") {
		return "temporary";
	}
	return "path";
}

function getAvailableSkillSourceLabel(source: AvailableSkill["source"]): string {
	switch (source) {
		case "project":
			return "Project";
		case "user":
			return "User";
		case "extension":
			return "Extension";
		case "temporary":
			return "Temporary";
		case "path":
		default:
			return "Path";
	}
}

export async function getAvailableSkills(cwd: string): Promise<AvailableSkill[]> {
	const settingsManager = SettingsManager.create(cwd, APREAL_AGENT_DIR);
	const resourceLoader = await createResourceLoader(cwd, settingsManager);
	return resourceLoader.getSkills().skills.map((skill) => {
		const source = getAvailableSkillSource(skill.sourceInfo);
		return {
			name: skill.name,
			description: skill.description,
			source,
			sourceLabel: getAvailableSkillSourceLabel(source),
			location: skill.filePath,
		};
	});
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

export function buildAgentHistory(
	history: AgentHistoryMessage[],
	model: Pick<Model<any>, "api" | "provider" | "id">,
): Message[] {
	return history.flatMap((entry): Message[] => {
		const body = entry.body.trim();
		if (!body) {
			return [];
		}

		if (entry.role === "user") {
			return [{
				role: "user",
				content: body,
				timestamp: entry.createdAt,
			}];
		}

		return [{
			role: "assistant",
			content: [{ type: "text", text: body }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: entry.createdAt,
		}];
	});
}

async function createPiSession(
	cwd: string,
	customTools: ToolDefinition[] = agentToolsConfig.customTools,
	history: AgentHistoryMessage[] = [],
) {
	const runtime = createPiRuntime(cwd);
	const resourceLoader = await createResourceLoader(cwd, runtime.settingsManager);
	const sessionManager = SessionManager.inMemory(cwd);
	const result = await createAgentSession({
		cwd,
		agentDir: APREAL_AGENT_DIR,
		authStorage: runtime.authStorage,
		modelRegistry: runtime.modelRegistry,
		resourceLoader,
		settingsManager: runtime.settingsManager,
		sessionManager,
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

	for (const message of buildAgentHistory(history, model)) {
		sessionManager.appendMessage(message);
	}
	if (history.length > 0) {
		result.session.agent.state.messages = sessionManager.buildSessionContext().messages;
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

	const { session, model, modelInfo } = await createPiSession(cwd, options?.customTools, options?.history);
	const listeners = new Set<(event: AgentStreamEvent) => void>();
	let disposed = false;
	let activeModel = model;
	let activeModelInfo = modelInfo;
	let userTurnCount = options?.history?.filter((message) => message.role === "user").length ?? 0;
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
		get model() {
			return activeModel;
		},
		get modelInfo() {
			return activeModelInfo;
		},
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
		setModel: async (provider: string, modelId: string) => {
			if (disposed) {
				throw new Error("Agent session has already been disposed.");
			}
			if (session.isStreaming) {
				throw new Error("Cannot change the model while the agent is responding.");
			}

			const nextModel = session.modelRegistry.find(provider, modelId);
			if (!nextModel) {
				throw new Error(`The selected model (${provider}/${modelId}) is not available for this session.`);
			}

			await session.setModel(nextModel);
			activeModel = nextModel;
			activeModelInfo = buildAgentModelInfo(nextModel, session.modelRegistry);
			logger.info("agent model changed", { model: formatModelLabel(nextModel) });
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

			userTurnCount += 1;
			const promptInput = shouldNudgeMemoryReview(userTurnCount)
				? appendMemoryReviewNudge(input)
				: input;
			await session.reload();
			await session.prompt(promptInput);
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
	const oauthProviderIds = new Set(runtime.authStorage.getOAuthProviders().map((provider) => provider.id));
	const knownProviderIds = new Set<string>([
		...configuredProviderIds,
		...modelsByProvider.keys(),
		...oauthProviderIds,
		...getProviders(),
	]);
	const providers = [...knownProviderIds].map((id) => {
		const credential = runtime.authStorage.get(id);
		return {
			id,
			authType: (credential?.type ?? (oauthProviderIds.has(id) ? "oauth" : "api_key")) as "oauth" | "api_key",
			supportsOAuth: oauthProviderIds.has(id),
			supportsApiKey: true,
			loginState: {
				status: "idle",
				authUrl: null,
				error: null,
				updatedAt: null,
			} as ProviderLoginState,
			models: modelsByProvider.get(id) ?? [],
		};
	});

	providers.sort((left, right) => left.id.localeCompare(right.id));

	return {
		providers,
		defaultProvider: runtime.settingsManager.getDefaultProvider() ?? null,
		defaultModel: runtime.settingsManager.getDefaultModel() ?? null,
	};
}

export function buildProvidersPayload(
	cwd: string,
	readLoginState?: (providerId: string) => ProviderLoginState | null,
): ProvidersResponse {
	const authStorage = AuthStorage.create(APREAL_AGENT_AUTH_PATH);
	applyLegacyEnvCredentialAliases(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage, APREAL_AGENT_MODELS_PATH);
	const settingsManager = SettingsManager.create(cwd, APREAL_AGENT_DIR);

	const payload = buildProvidersPayloadFromRuntime({
		authStorage,
		modelRegistry,
		settingsManager,
	});
	if (!readLoginState) {
		return payload;
	}

	return {
		...payload,
		providers: payload.providers.map((provider) => ({
			...provider,
			loginState: readLoginState(provider.id) ?? provider.loginState,
		})),
	};
}

export async function setDefaultProviderModel(
	cwd: string,
	provider: string,
	modelId: string,
	readLoginState?: (providerId: string) => ProviderLoginState | null,
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

	const payload = buildProvidersPayloadFromRuntime({
		authStorage,
		modelRegistry,
		settingsManager,
	});
	if (!readLoginState) {
		return payload;
	}

	return {
		...payload,
		providers: payload.providers.map((entry) => ({
			...entry,
			loginState: readLoginState(entry.id) ?? entry.loginState,
		})),
	};
}
