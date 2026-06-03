import { useEffect, useMemo, useState } from "react";
import type { AvailableSkill, AvailableTool, CreateMcpServerRequest, LocalWebAdminStatus, McpServerConfig, McpServerTransport, ProvidersResponse, UpdateMcpServerRequest } from "@apreal/shared";
import type { ScheduledJobDetails, SessionCacheEntry, SessionSummary } from "../chatTypes";
import { JobsPanel } from "./JobsPanel";

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	"anthropic": "Anthropic",
	"openai": "OpenAI",
	"openrouter": "OpenRouter",
	"azure-openai-responses": "Azure OpenAI",
	"cerebras": "Cerebras",
	"cloudflare-ai-gateway": "Cloudflare AI Gateway",
	"cloudflare-workers-ai": "Cloudflare Workers AI",
	"deepseek": "DeepSeek",
	"fireworks": "Fireworks",
	"github-copilot": "GitHub Copilot",
	"google": "Google",
	"google-gemini-cli": "Google Gemini CLI",
	"google-antigravity": "Google Antigravity",
	"google-vertex": "Google Vertex AI",
	"openai-codex": "OpenAI Codex",
	"opencode": "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	"xai": "xAI (Grok)",
	"groq": "Groq",
	"huggingface": "Hugging Face",
	"kimi-coding": "Kimi Coding",
	"minimax": "MiniMax",
	"minimax-cn": "MiniMax China",
	"mistral": "Mistral",
	"moonshotai": "Moonshot AI",
	"moonshotai-cn": "Moonshot AI China",
	"amazon-bedrock": "Amazon Bedrock",
	"together": "Together AI",
	"vercel-ai-gateway": "Vercel AI Gateway",
	"xiaomi": "Xiaomi",
	"xiaomi-token-plan-ams": "Xiaomi Token Plan AMS",
	"xiaomi-token-plan-cn": "Xiaomi Token Plan China",
	"xiaomi-token-plan-sgp": "Xiaomi Token Plan Singapore",
	"zai": "Z.ai",
};

function formatProviderId(id: string): string {
	return PROVIDER_DISPLAY_NAMES[id] ?? id;
}

type SearchableModel = {
	key: string;
	providerId: string;
	providerLabel: string;
	authType: "oauth" | "api_key";
	modelId: string;
	modelName: string;
	label: string;
	searchText: string;
	isDefault: boolean;
};

type SearchableProvider = {
	id: string;
	label: string;
	searchText: string;
	isDefault: boolean;
	isConfigured: boolean;
	authType: "oauth" | "api_key";
	supportsOAuth: boolean;
	supportsApiKey: boolean;
	loginState: ProvidersResponse["providers"][number]["loginState"];
	models: ProvidersResponse["providers"][number]["models"];
};

const DEFAULT_VISIBLE_PROVIDER_COUNT = 8;

function normalizeSearchValue(value: string): string {
	return value.trim().toLowerCase();
}

type SettingsPageProps = {
	adminStatus: LocalWebAdminStatus | null;
	statusError: string | null;
	providers: ProvidersResponse | null;
	providersError: string | null;
	mcpServers: McpServerConfig[];
	mcpServersError: string | null;
	isLoadingMcpServers: boolean;
	isSubmitting: boolean;
	submissionMessage: string | null;
	submissionError: string | null;
	jobs: ScheduledJobDetails[];
	jobRuns: SessionSummary[];
	sessionCache: Map<string, SessionCacheEntry>;
	jobsError: string | null;
	jobRunsError: string | null;
	isLoadingJobs: boolean;
	isLoadingJobRuns: boolean;
	connectionError: string | null;
	onBack: () => void;
	onRefresh: () => void;
	onRefreshJobs: () => void;
	onRefreshJobRuns: (jobId: string) => void;
	onUpdateJobInterval: (jobId: string, intervalMinutes: number) => Promise<void>;
	onToggleJobEnabled: (jobId: string, enabled: boolean) => Promise<void>;
	onDeleteJob: (jobId: string) => Promise<void>;
	onEnsureRunLoaded: (runId: string) => void;
	onSetDefaultModel: (provider: string, modelId: string) => Promise<void>;
	onStartProviderLogin: (provider: string) => Promise<void>;
	onSaveProviderApiKey: (provider: string, apiKey: string) => Promise<void>;
	onCreateMcpServer: (request: CreateMcpServerRequest) => Promise<void>;
	onUpdateMcpServer: (serverId: string, request: UpdateMcpServerRequest) => Promise<void>;
	onDeleteMcpServer: (serverId: string) => Promise<void>;
	onRefreshMcpServers: () => void;
	onSubmitPairingCode: (pairingCode: string) => void;
};

function renderStatusPill(label: string, tone: "neutral" | "success" | "danger") {
	const toneClassName = tone === "success"
		? "border-slate-300 bg-white text-slate-800 font-semibold"
		: tone === "danger"
			? "border-slate-400 bg-slate-200 text-slate-800 font-semibold"
			: "border-slate-300 bg-slate-100 text-slate-600 font-semibold";

	return (
		<span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-mono text-[0.67rem] uppercase tracking-[0.12em] ${toneClassName}`}>
			{tone === "success" && <span className="h-1.5 w-1.5 rounded-full bg-slate-800" />}
			{label}
		</span>
	);
}

type SettingsSection = "connection" | "models" | "skills" | "mcp" | "tools" | "jobs";

const SECTIONS: { id: SettingsSection; label: string }[] = [
	{ id: "connection", label: "Connection" },
	{ id: "models", label: "Model control" },
	{ id: "skills", label: "Skills" },
	{ id: "mcp", label: "MCP" },
	{ id: "tools", label: "Tools" },
	{ id: "jobs", label: "Schedules & jobs" },
];

const SECTION_TITLES: Record<SettingsSection, string> = {
	connection: "Connection",
	models: "Model configuration",
	skills: "Available skills",
	mcp: "MCP servers",
	tools: "Available tools",
	jobs: "Scheduled automated tasks",
};

const MCP_TRANSPORT_OPTIONS: { value: McpServerTransport; label: string; description: string }[] = [
	{ value: "stdio", label: "stdio", description: "Launches a local process from this machine." },
	{ value: "http", label: "http", description: "Connects to a remote MCP server over HTTP." },
	{ value: "sse", label: "sse", description: "Connects to a remote MCP server over Server-Sent Events." },
];

function parseLineSeparatedList(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function parseKeyValueText(value: string, label: string): Record<string, string> {
	const record: Record<string, string> = {};
	for (const line of value.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex <= 0) {
			throw new Error(`${label} entries must use KEY=VALUE format.`);
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		const entryValue = trimmed.slice(separatorIndex + 1);
		if (!key) {
			throw new Error(`${label} keys must be non-empty.`);
		}

		record[key] = entryValue;
	}

	return record;
}

function stringifyKeyValueRecord(record: Record<string, string>): string {
	return Object.entries(record)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

function getMcpRuntimeTone(server: McpServerConfig): "neutral" | "success" | "danger" {
	const state = server.runtime?.state;
	if (state === "ready") {
		return "success";
	}
	if (state === "error") {
		return "danger";
	}
	return "neutral";
}

function getMcpRuntimeLabel(server: McpServerConfig): string {
	switch (server.runtime?.state) {
		case "ready":
			return "Ready";
		case "connecting":
			return "Connecting";
		case "error":
			return "Error";
		case "disabled":
			return "Disabled";
		case "idle":
		default:
			return server.enabled ? "Idle" : "Disabled";
	}
}

function getToolToneClassName(kind: AvailableTool["kind"]): string {
	return kind === "built_in"
		? "border-slate-300 bg-white text-slate-700"
		: "border-emerald-300 bg-emerald-50 text-emerald-800";
}

function getToolKindLabel(kind: AvailableTool["kind"]): string {
	return kind === "built_in" ? "Default" : "Custom";
}

function getSkillToneClassName(source: AvailableSkill["source"]): string {
	switch (source) {
		case "project":
			return "border-sky-300 bg-sky-50 text-sky-800";
		case "extension":
			return "border-amber-300 bg-amber-50 text-amber-800";
		case "temporary":
			return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800";
		case "path":
			return "border-slate-300 bg-white text-slate-700";
		case "user":
		default:
			return "border-emerald-300 bg-emerald-50 text-emerald-800";
	}
}

function SectionIcon({ section }: { section: SettingsSection }) {
	if (section === "connection") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path d="M6 9V6.75A1.75 1.75 0 0 1 7.75 5h8.5A1.75 1.75 0 0 1 18 6.75V9" strokeLinecap="round" strokeLinejoin="round" />
				<rect x="4" y="9" width="16" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M8 14h.01M12 14h.01M16 14h.01" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (section === "jobs") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<circle cx="12" cy="12" r="10" />
				<path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (section === "skills") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path d="M8 7.5h8M8 12h6M8 16.5h8" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M4.5 7.5h.01M4.5 12h.01M4.5 16.5h.01" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (section === "mcp") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path d="M8 8h8v8H8z" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M3 12h5M16 12h5M12 3v5M12 16v5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (section === "tools") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path d="M14.7 6.3a4 4 0 0 0-5.4 5.88L4 17.5V20h2.5l5.32-5.3a4 4 0 0 0 5.88-5.4l-2.65 2.64-2.35-2.34L14.7 6.3Z" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	return (
		<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
			<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function SettingsPage({
	adminStatus,
	statusError,
	providers,
	providersError,
	mcpServers,
	mcpServersError,
	isLoadingMcpServers,
	isSubmitting,
	submissionMessage,
	submissionError,
	jobs,
	jobRuns,
	sessionCache,
	jobsError,
	jobRunsError,
	isLoadingJobs,
	isLoadingJobRuns,
	connectionError,
	onBack,
	onRefresh,
	onRefreshJobs,
	onRefreshJobRuns,
	onUpdateJobInterval,
	onToggleJobEnabled,
	onDeleteJob,
	onEnsureRunLoaded,
	onSetDefaultModel,
	onStartProviderLogin,
	onSaveProviderApiKey,
	onCreateMcpServer,
	onUpdateMcpServer,
	onDeleteMcpServer,
	onRefreshMcpServers,
	onSubmitPairingCode,
}: SettingsPageProps) {
	const [activeSection, setActiveSection] = useState<SettingsSection>("connection");
	const [pairingCode, setPairingCode] = useState("");
	const [modelQuery, setModelQuery] = useState("");
	const [providerQuery, setProviderQuery] = useState("");
	const [showAllProviders, setShowAllProviders] = useState(false);
	const [modelUpdateError, setModelUpdateError] = useState<string | null>(null);
	const [modelUpdateMessage, setModelUpdateMessage] = useState<string | null>(null);
	const [savingModelKey, setSavingModelKey] = useState<string | null>(null);
	const [authActionProviderId, setAuthActionProviderId] = useState<string | null>(null);
	const [providerAuthError, setProviderAuthError] = useState<string | null>(null);
	const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
	const [apiKeyEditorProviderId, setApiKeyEditorProviderId] = useState<string | null>(null);
	const [mcpEditingServerId, setMcpEditingServerId] = useState<string | null>(null);
	const [mcpName, setMcpName] = useState("");
	const [mcpTransport, setMcpTransport] = useState<McpServerTransport>("stdio");
	const [mcpEnabled, setMcpEnabled] = useState(true);
	const [mcpCommand, setMcpCommand] = useState("");
	const [mcpArgs, setMcpArgs] = useState("");
	const [mcpEnv, setMcpEnv] = useState("");
	const [mcpUrl, setMcpUrl] = useState("");
	const [mcpHeaders, setMcpHeaders] = useState("");
	const [mcpFormError, setMcpFormError] = useState<string | null>(null);
	const [mcpFormMessage, setMcpFormMessage] = useState<string | null>(null);
	const [mcpActionServerId, setMcpActionServerId] = useState<string | null>(null);

	useEffect(() => {
		if (submissionMessage) {
			setPairingCode("");
		}
	}, [submissionMessage]);

	const resetMcpForm = () => {
		setMcpEditingServerId(null);
		setMcpName("");
		setMcpTransport("stdio");
		setMcpEnabled(true);
		setMcpCommand("");
		setMcpArgs("");
		setMcpEnv("");
		setMcpUrl("");
		setMcpHeaders("");
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSubmitPairingCode(pairingCode);
	};

	const searchableModels = useMemo(() => {
		if (!providers) {
			return [] as SearchableModel[];
		}

		const flattened = providers.providers.flatMap((provider) =>
			provider.models.map((model) => ({
				key: `${provider.id}:${model.id}`,
				providerId: provider.id,
				providerLabel: formatProviderId(provider.id),
				authType: provider.authType,
				modelId: model.id,
				modelName: model.name,
				isDefault: provider.id === providers.defaultProvider && model.id === providers.defaultModel,
			})),
		);
		const duplicateNameCounts = new Map<string, number>();
		for (const item of flattened) {
			const key = normalizeSearchValue(item.modelName);
			duplicateNameCounts.set(key, (duplicateNameCounts.get(key) ?? 0) + 1);
		}

		return flattened
			.map((item) => {
				const duplicateNameCount = duplicateNameCounts.get(normalizeSearchValue(item.modelName)) ?? 0;
				const label = duplicateNameCount > 1
					? `${item.modelName} (${item.providerLabel})`
					: item.modelName;
				return {
					...item,
					label,
					searchText: normalizeSearchValue(
						`${item.modelName} ${item.modelId} ${item.providerLabel} ${item.providerId}`,
					),
				};
			})
			.sort((left, right) =>
				Number(right.isDefault) - Number(left.isDefault) ||
				left.modelName.localeCompare(right.modelName) ||
				left.providerLabel.localeCompare(right.providerLabel) ||
				left.modelId.localeCompare(right.modelId),
			);
	}, [providers]);

	const normalizedModelQuery = normalizeSearchValue(modelQuery);
	const visibleModels = useMemo(() => {
		if (normalizedModelQuery) {
			return searchableModels.filter((model) => model.searchText.includes(normalizedModelQuery));
		}

		return searchableModels.filter((model) => model.isDefault).slice(0, 1);
	}, [normalizedModelQuery, searchableModels]);

	const currentDefaultModel = useMemo(
		() => searchableModels.find((model) => model.isDefault) ?? null,
		[searchableModels],
	);

	const searchableProviders = useMemo(() => {
		if (!providers) {
			return [] as SearchableProvider[];
		}

		return providers.providers
			.map((provider) => ({
				id: provider.id,
				label: formatProviderId(provider.id),
				searchText: normalizeSearchValue(
					`${formatProviderId(provider.id)} ${provider.id} ${provider.authType} ${
						provider.supportsOAuth ? "oauth subscription provider login" : ""
					} ${provider.supportsApiKey ? "api key" : ""}`,
				),
				isDefault: provider.id === providers.defaultProvider,
				isConfigured: provider.models.length > 0 || provider.authType === "oauth" || provider.loginState.status === "succeeded",
				authType: provider.authType,
				supportsOAuth: provider.supportsOAuth,
				supportsApiKey: provider.supportsApiKey,
				loginState: provider.loginState,
				models: provider.models,
			}))
			.sort((left, right) =>
				Number(right.isDefault) - Number(left.isDefault) ||
				Number(right.isConfigured) - Number(left.isConfigured) ||
				left.label.localeCompare(right.label) ||
				left.id.localeCompare(right.id),
			);
	}, [providers]);

	const normalizedProviderQuery = normalizeSearchValue(providerQuery);
	const filteredProviders = useMemo(() => {
		if (!normalizedProviderQuery) {
			return searchableProviders;
		}

		return searchableProviders.filter((provider) => provider.searchText.includes(normalizedProviderQuery));
	}, [normalizedProviderQuery, searchableProviders]);

	const visibleProviders = useMemo(() => {
		if (showAllProviders || normalizedProviderQuery) {
			return filteredProviders;
		}

		return filteredProviders.slice(0, DEFAULT_VISIBLE_PROVIDER_COUNT);
	}, [filteredProviders, normalizedProviderQuery, showAllProviders]);

	const hiddenProviderCount = Math.max(0, filteredProviders.length - visibleProviders.length);

	const handleSelectModel = async (providerId: string, modelId: string) => {
		const key = `${providerId}:${modelId}`;
		setSavingModelKey(key);
		setModelUpdateError(null);
		setModelUpdateMessage(null);
		try {
			await onSetDefaultModel(providerId, modelId);
			setModelUpdateMessage("Default model updated for new chats.");
		} catch (error) {
			setModelUpdateError(error instanceof Error ? error.message : "Failed to update the default model.");
		} finally {
			setSavingModelKey(null);
		}
	};

	const handleStartLogin = async (providerId: string) => {
		setAuthActionProviderId(providerId);
		setProviderAuthError(null);
		try {
			await onStartProviderLogin(providerId);
		} catch (error) {
			setProviderAuthError(error instanceof Error ? error.message : "Failed to start provider login.");
		} finally {
			setAuthActionProviderId(null);
		}
	};

	const handleSaveApiKey = async (providerId: string) => {
		const apiKey = apiKeyDrafts[providerId]?.trim() ?? "";
		if (!apiKey) {
			setProviderAuthError("An API key is required.");
			return;
		}

		setAuthActionProviderId(providerId);
		setProviderAuthError(null);
		try {
			await onSaveProviderApiKey(providerId, apiKey);
			setApiKeyDrafts((previous) => ({ ...previous, [providerId]: "" }));
			setApiKeyEditorProviderId(null);
		} catch (error) {
			setProviderAuthError(error instanceof Error ? error.message : "Failed to save API key.");
		} finally {
			setAuthActionProviderId(null);
		}
	};

	const handleProviderQueryChange = (value: string) => {
		setProviderQuery(value);
		if (value.trim()) {
			setShowAllProviders(true);
		}
	};

	const handleEditMcpServer = (server: McpServerConfig) => {
		setMcpEditingServerId(server.id);
		setMcpName(server.name);
		setMcpTransport(server.transport);
		setMcpEnabled(server.enabled);
		setMcpCommand(server.command ?? "");
		setMcpArgs(server.args.join("\n"));
		setMcpEnv(stringifyKeyValueRecord(server.env));
		setMcpUrl(server.url ?? "");
		setMcpHeaders(stringifyKeyValueRecord(server.headers));
		setMcpFormError(null);
		setMcpFormMessage(null);
	};

	const handleSubmitMcpServer = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setMcpFormError(null);
		setMcpFormMessage(null);
		setMcpActionServerId(mcpEditingServerId ?? "new");

		try {
			const request = {
				name: mcpName.trim(),
				transport: mcpTransport,
				enabled: mcpEnabled,
				command: mcpCommand.trim() || null,
				args: parseLineSeparatedList(mcpArgs),
				env: parseKeyValueText(mcpEnv, "Environment"),
				url: mcpUrl.trim() || null,
				headers: parseKeyValueText(mcpHeaders, "Headers"),
			};

			if (mcpEditingServerId) {
				await onUpdateMcpServer(mcpEditingServerId, request);
				setMcpFormMessage("MCP server updated.");
			} else {
				await onCreateMcpServer(request);
				setMcpFormMessage("MCP server created.");
			}

			resetMcpForm();
		} catch (error) {
			setMcpFormError(error instanceof Error ? error.message : "Failed to save MCP server.");
		} finally {
			setMcpActionServerId(null);
		}
	};

	const handleToggleMcpServer = async (server: McpServerConfig) => {
		setMcpActionServerId(server.id);
		setMcpFormError(null);
		setMcpFormMessage(null);
		try {
			await onUpdateMcpServer(server.id, { enabled: !server.enabled });
			setMcpFormMessage(server.enabled ? "MCP server disabled." : "MCP server enabled.");
		} catch (error) {
			setMcpFormError(error instanceof Error ? error.message : "Failed to update MCP server.");
		} finally {
			setMcpActionServerId(null);
		}
	};

	const handleDeleteSelectedMcpServer = async (serverId: string) => {
		setMcpActionServerId(serverId);
		setMcpFormError(null);
		setMcpFormMessage(null);
		try {
			await onDeleteMcpServer(serverId);
			if (mcpEditingServerId === serverId) {
				resetMcpForm();
			}
			setMcpFormMessage("MCP server removed.");
		} catch (error) {
			setMcpFormError(error instanceof Error ? error.message : "Failed to delete MCP server.");
		} finally {
			setMcpActionServerId(null);
		}
	};

	const isOnline = Boolean(adminStatus);
	const relayReady = Boolean(adminStatus?.relayReady);
	const activeSectionTitle = SECTION_TITLES[activeSection];
	const availableSkills = adminStatus?.availableSkills ?? [];
	const availableTools = adminStatus?.availableTools ?? [];
	const enabledMcpServerCount = mcpServers.filter((server) => server.enabled).length;
	const readyMcpServerCount = mcpServers.filter((server) => server.runtime?.state === "ready").length;
	const mcpToolCount = mcpServers.reduce((total, server) => total + (server.runtime?.toolCount ?? 0), 0);

	return (
		<main className="min-h-svh bg-[#f3f3f1] text-[#171717] selection:bg-black/10 selection:text-black">
			<div className="flex min-h-svh w-full flex-col">
				{/* ---- Main layout: sidebar + content ---- */}
				<div className="grid flex-1 min-[961px]:grid-cols-[280px_minmax(0,1fr)] min-[1320px]:grid-cols-[300px_minmax(0,1fr)]">
					{/* ======== SIDEBAR ======== */}
					<nav className="flex flex-col gap-3 border-b border-black/10 bg-[#101010] min-[961px]:sticky min-[961px]:top-0 min-[961px]:min-h-svh min-[961px]:self-start min-[961px]:border-r min-[961px]:border-b-0">
						{/* Mobile: horizontal scroll tabs */}
						<div className="flex gap-1 overflow-x-auto px-3 py-3 min-[961px]:hidden scrollbar-thin">
							{SECTIONS.map((section) => (
								<button
									key={section.id}
									type="button"
									onClick={() => setActiveSection(section.id)}
									className={`flex shrink-0 items-center gap-2 border px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer ${
										activeSection === section.id
											? "border-black bg-black text-white"
											: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
									}`}
								>
									<SectionIcon section={section.id} />
									{section.label}
								</button>
							))}
						</div>

						{/* Desktop: vertical sidebar */}
						<div className="hidden text-white min-[961px]:flex min-[961px]:min-h-svh min-[961px]:flex-col">
							<div className="border-b border-white/8 px-5 py-4">
								<h2 className="text-[1rem] font-semibold tracking-tight text-white">
									Settings
								</h2>
							</div>
							<div className="flex flex-1 flex-col py-2">
								{SECTIONS.map((section) => (
									<button
										key={section.id}
										type="button"
										onClick={() => setActiveSection(section.id)}
										className={`flex items-center gap-3 border-l-2 px-5 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer ${
											activeSection === section.id
												? "border-white bg-white text-black"
												: "border-transparent text-white/78 hover:bg-white/6 hover:text-white"
										}`}
									>
										<span className={`mt-0.5 shrink-0 ${activeSection === section.id ? "text-black" : "text-white/40"}`}>
											<SectionIcon section={section.id} />
										</span>
										<span className={`text-[0.92rem] font-semibold leading-tight ${activeSection === section.id ? "text-black" : "text-white"}`}>
											{section.label}
										</span>
									</button>
								))}
								<div className="mt-auto border-t border-white/8 px-5 py-4">
									<button
										type="button"
										className="inline-flex w-full items-center justify-center gap-2 border border-white/12 bg-white/6 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
										onClick={onBack}
									>
										<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
											<path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
										</svg>
										Back to chat
									</button>
								</div>
							</div>
						</div>
					</nav>

					{/* ======== CONTENT ======== */}
					<div className="min-w-0 bg-white p-4 min-[961px]:min-h-svh min-[961px]:p-6">
						<header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/8 pb-4">
							<div>
								<h1 className="text-[1.45rem] font-bold tracking-tight leading-none text-slate-900 min-[961px]:text-[1.7rem]">
									{activeSectionTitle}
								</h1>
							</div>
							<div className="flex shrink-0 flex-wrap items-center gap-2.5">
								<div className="hidden items-center gap-2 border border-black/8 bg-white px-3 py-2 text-[0.74rem] font-medium text-slate-500 min-[1100px]:inline-flex">
									<span className={`inline-block h-2 w-2 rounded-full ${isOnline ? "bg-slate-900" : "bg-slate-400"}`} />
									<span className="font-mono uppercase tracking-[0.1em]">
										{isOnline ? `Server :${adminStatus?.port ?? ""}` : "Server offline"}
									</span>
									<span className="text-slate-300">/</span>
									<span className="font-mono uppercase tracking-[0.1em]">
										{relayReady ? "Paired" : "Awaiting pairing"}
									</span>
								</div>
								{activeSection === "jobs" ? (
									<button
										type="button"
										className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-[#171717] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
										onClick={onRefreshJobs}
									>
										<svg className={`h-4 w-4 ${isLoadingJobs ? "animate-spin text-slate-700" : "text-[#525252]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
											<path strokeLinecap="round" strokeLinejoin="round" d="M160 80A80 80 0 10240 160" />
											<path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8h-4.21" />
										</svg>
										{isLoadingJobs ? "Syncing..." : "Sync Jobs"}
									</button>
								) : activeSection === "mcp" ? (
									<button
										type="button"
										className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-[#171717] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
										onClick={onRefreshMcpServers}
										disabled={isLoadingMcpServers}
									>
										<svg className={`h-4 w-4 ${isLoadingMcpServers ? "animate-spin text-slate-700" : "text-[#525252]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
											<path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8h-4.21" />
										</svg>
										{isLoadingMcpServers ? "Syncing..." : "Sync MCP"}
									</button>
								) : (
									<button
										type="button"
										className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-[#171717] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
										onClick={onRefresh}
									>
										<svg className="h-4 w-4 text-[#525252]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
											<path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8h-4.21" />
										</svg>
										Refresh status
									</button>
								)}
								<button
									type="button"
									className="inline-flex items-center gap-2 border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer min-[961px]:hidden"
									onClick={onBack}
								>
									<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
										<path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
									</svg>
									Back to chat
								</button>
							</div>
						</header>

						<div className="mt-4 space-y-4">
						{activeSection === "connection" && (
							<div className="space-y-4">
								<div className="border border-black/8 bg-white p-5">
									<div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Connection Overview</p>
											<h2 className="mt-1 text-base font-bold text-slate-900">Runtime, pairing, and gateway state</h2>
										</div>
										{adminStatus
											? renderStatusPill(
												relayReady && adminStatus.relayTransportConnected ? "Healthy" : "Attention",
												relayReady && adminStatus.relayTransportConnected ? "success" : "neutral",
											)
											: renderStatusPill("Offline", "danger")}
									</div>

									{statusError ? (
										<p className="mt-3 border border-slate-300 bg-slate-100 p-3 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">
											{statusError}
										</p>
									) : null}
									{connectionError ? (
										<p className="mt-3 border border-slate-300 bg-white p-3 text-[0.84rem] leading-[1.5] text-slate-700 font-medium">
											{connectionError}
										</p>
									) : null}

									<div className="mt-4 grid gap-3 min-[700px]:grid-cols-3">
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Local Server</p>
											<p className="mt-2 text-base font-bold text-slate-900">
												{adminStatus ? `Online on :${adminStatus.port}` : "Offline"}
											</p>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Relay Pairing</p>
											<p className="mt-2 text-base font-bold text-slate-900">{relayReady ? "Paired" : "Awaiting pairing"}</p>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Gateway Transport</p>
											<p className="mt-2 text-base font-bold text-slate-900">
												{adminStatus?.relayTransportConnected ? "Connected" : "Idle"}
											</p>
										</div>
									</div>

									<dl className="mt-4 grid gap-3 text-sm leading-[1.5] min-[700px]:grid-cols-2">
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Active Port</dt>
											<dd className="mt-2 text-base font-bold text-slate-900 font-mono">{adminStatus?.port ?? "Unavailable"}</dd>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Local Agent ID</dt>
											<dd className="mt-2 break-all text-[0.92rem] font-semibold text-slate-800 font-mono">{adminStatus?.agentId ?? "Not registered"}</dd>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Connected Clients</dt>
											<dd className="mt-2 text-base font-bold text-slate-900 font-mono">{adminStatus?.clients ?? "Unavailable"}</dd>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Stored Sessions</dt>
											<dd className="mt-2 text-base font-bold text-slate-900 font-mono">{adminStatus?.sessions ?? "Unavailable"}</dd>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3 min-[700px]:col-span-2">
											<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Root Workspace CWD</dt>
											<dd className="mt-2 break-all text-[0.86rem] font-medium text-slate-700 font-mono">{adminStatus?.cwd ?? "Unavailable"}</dd>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3 min-[700px]:col-span-2">
											<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Web UI Build State</dt>
											<dd className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
												<span className={`h-2 w-2 rounded-full ${adminStatus?.webUiReady ? "bg-slate-900" : "bg-slate-400"}`} />
												{adminStatus?.webUiReady ? "Ready (Vite compiler online)" : "Awaiting Vite compiler output"}
												{adminStatus?.webUiPath ? <span className="text-[#64748b] font-mono text-[0.78rem] font-normal"> · {adminStatus.webUiPath}</span> : ""}
											</dd>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3 min-[700px]:col-span-2">
											<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Relay Gateway URL</dt>
											<dd className="mt-2 break-all text-[0.86rem] font-medium text-slate-700 font-mono">{adminStatus?.relayUrl ?? "Unavailable"}</dd>
										</div>
										{adminStatus?.relayStartupError ? (
											<div className="border border-slate-300 bg-slate-100 px-3.5 py-3 min-[700px]:col-span-2">
												<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-700">Gateway startup error</p>
												<p className="mt-2 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">{adminStatus.relayStartupError}</p>
											</div>
										) : null}
									</dl>
								</div>

								<form className="border border-black/8 bg-white p-5" onSubmit={handleSubmit}>
									<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Pairing</p>
									<h2 className="mt-1 text-base font-bold text-slate-900">Configure relay pairing code</h2>

									<label className="mt-4 block">
										<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Six-character pairing code</span>
										<input
											type="text"
											value={pairingCode}
											onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
											placeholder="ABC123"
											className="mt-2 w-full border border-slate-300 bg-[#f8f8f8] px-3 py-2.5 font-mono text-[1rem] font-bold tracking-[0.22em] text-[#171717] placeholder:text-slate-300 outline-none transition focus:border-slate-500 focus:bg-white"
											autoComplete="off"
											autoCapitalize="characters"
											spellCheck={false}
										/>
									</label>

									<button
										type="submit"
										className="mt-4 w-full flex items-center justify-center border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
										disabled={isSubmitting || pairingCode.trim().length === 0}
									>
										{isSubmitting ? "Syncing handshake..." : "Reauthenticate & Sync pairing"}
									</button>

									{submissionMessage ? (
										<p className="mt-3 border border-slate-300 bg-white p-3 text-[0.84rem] leading-[1.5] text-slate-700 font-medium">
											{submissionMessage}
										</p>
									) : null}
									{submissionError ? (
										<p className="mt-3 border border-slate-300 bg-slate-100 p-3 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">
											{submissionError}
										</p>
									) : null}
								</form>
							</div>
						)}

						{/* ---------- MODELS SECTION ---------- */}
						{activeSection === "models" && (
							<div className="space-y-4">
								<div className="border border-black/8 bg-white p-5">
									<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Agent Provisioning</p>
									<h2 className="mt-1 text-base font-bold text-slate-900">Set default intelligence model</h2>

									{providersError ? (
										<p className="mt-3 border border-slate-300 bg-slate-100 p-3 text-[0.82rem] leading-[1.5] text-slate-800 font-medium">
											{providersError}
										</p>
									) : null}

									{providers && providers.providers.length === 0 ? (
										<p className="mt-3 border border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-500 text-center">
											No active providers configured yet.
										</p>
									) : null}

									{providers && providers.providers.length > 0 ? (
										<div className="mt-5 space-y-6">
											<div className="grid gap-5 border-b border-slate-200/80 pb-5 min-[1180px]:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
												<div>
													<label className="block">
														<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">
															Deep search models
														</span>
														<div className="relative mt-2">
															<input
																type="search"
																value={modelQuery}
																onChange={(event) => setModelQuery(event.target.value)}
																placeholder="Type model id, name, or cloud provider..."
																className="w-full border border-slate-300 bg-white pl-9 pr-3 py-3 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500"
																autoComplete="off"
																spellCheck={false}
															/>
															<span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
																<svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.5">
																	<circle cx="11" cy="11" r="8" />
																	<path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" />
																</svg>
															</span>
														</div>
													</label>

													<p className="mt-2.5 text-[0.78rem] leading-[1.45] text-slate-500 font-medium">
														{normalizedModelQuery ? `Showing ${visibleModels.length} result${visibleModels.length === 1 ? "" : "s"}.` : currentDefaultModel ? "Default selected." : "Search models."}
													</p>
												</div>

												<div>
													<label className="block">
														<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">
															Search providers
														</span>
														<div className="relative mt-2">
															<input
																type="search"
																value={providerQuery}
																onChange={(event) => handleProviderQueryChange(event.target.value)}
																placeholder="Type provider name, id, subscription, or api key..."
																className="w-full border border-slate-300 bg-white pl-9 pr-3 py-3 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500"
																autoComplete="off"
																spellCheck={false}
															/>
															<span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
																<svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.5">
																	<circle cx="11" cy="11" r="8" />
																	<path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" />
																</svg>
															</span>
														</div>
													</label>

													<div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[0.78rem] leading-[1.45] text-slate-500 font-medium">
														<p>
															{normalizedProviderQuery
																? `Showing ${visibleProviders.length} provider match${visibleProviders.length === 1 ? "" : "es"}.`
																: showAllProviders
																	? `Showing all ${visibleProviders.length} providers.`
																	: `Showing ${visibleProviders.length} of ${filteredProviders.length} providers.`}
														</p>
														{!normalizedProviderQuery && filteredProviders.length > DEFAULT_VISIBLE_PROVIDER_COUNT ? (
															<button
																type="button"
																className="border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
																onClick={() => setShowAllProviders((current) => !current)}
															>
																{showAllProviders ? "Show Fewer" : `Show ${hiddenProviderCount} More`}
															</button>
														) : null}
													</div>
												</div>
											</div>

											{modelUpdateMessage ? (
												<p className="border border-slate-300 bg-white px-3 py-2.5 text-xs leading-[1.5] text-slate-700 font-medium">
													{modelUpdateMessage}
												</p>
											) : null}
											{modelUpdateError ? (
												<p className="border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs leading-[1.5] text-slate-800 font-medium">
													{modelUpdateError}
												</p>
											) : null}
											{providerAuthError ? (
												<p className="border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs leading-[1.5] text-slate-800 font-medium">
													{providerAuthError}
												</p>
											) : null}

											<div className="grid gap-6 min-[1280px]:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
												<section className="space-y-3">
													<div className="flex items-center justify-between gap-3">
														<div>
															<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-400">Default model</p>
															<h3 className="mt-1 text-[1rem] font-bold text-slate-900">Choose what new chats start with</h3>
														</div>
														{currentDefaultModel ? renderStatusPill("Configured", "success") : renderStatusPill("Unselected", "neutral")}
													</div>

													{visibleModels.length > 0 ? (
														<ul className="overflow-hidden border border-slate-200 bg-[#fafaf8]">
															{visibleModels.map((model, index) => {
																const isSaving = savingModelKey === model.key;
																return (
																	<li
																		key={model.key}
																		className={`grid gap-3 px-4 py-3.5 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-center ${
																			index > 0 ? "border-t border-slate-200" : ""
																		}`}
																	>
																		<div className="min-w-0">
																			<p className="text-[0.92rem] font-bold text-slate-900">{model.label}</p>
																			<p className="mt-1 break-all text-[0.72rem] leading-tight font-mono text-slate-500 font-medium">
																				ID: {model.modelId} · {model.providerLabel} · <span className="text-slate-600 font-bold">{model.authType === "oauth" ? "Subscription" : "Custom Key"}</span>
																			</p>
																		</div>
																		<button
																			type="button"
																			className={`min-w-28 border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 min-[560px]:justify-self-end cursor-pointer ${
																				model.isDefault
																					? "border-slate-900 bg-slate-900 text-white"
																					: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
																			}`}
																			onClick={() => {
																				void handleSelectModel(model.providerId, model.modelId);
																			}}
																			disabled={isSaving || model.isDefault || savingModelKey !== null}
																		>
																			{isSaving ? "Locking..." : model.isDefault ? "Active Default" : "Set Default"}
																		</button>
																	</li>
																);
															})}
														</ul>
													) : (
														<p className="border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">
															{normalizedModelQuery
																? `No available models match "${modelQuery.trim()}".`
																: "Use search query to find models."}
														</p>
													)}
												</section>

												<section className="space-y-3">
													<div>
														<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-400">Providers</p>
														<h3 className="mt-1 text-[1rem] font-bold text-slate-900">Manage logins and API keys</h3>
													</div>

													<ul className="space-y-2.5">
											{visibleProviders.map((provider) => {
												const isDefaultProvider = provider.id === providers.defaultProvider && provider.models.some((m) =>
													m.id === providers.defaultModel
												);
												return (
													<li
														key={provider.id}
													className={`border p-3.5 ${
														isDefaultProvider ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/40"
													}`}
													>
														<div className="flex flex-wrap items-start justify-between gap-2">
															<div className="min-w-0">
																<p className="text-[0.92rem] font-bold text-slate-900">{formatProviderId(provider.id)}</p>
																<p className="mt-1.5 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-400">
																	ID: {provider.id}
																</p>
															</div>
														<div className="flex flex-wrap items-center gap-2">
																{isDefaultProvider ? (
															<span className="inline-flex border border-slate-900 bg-slate-900 px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-white">
																		Default provider
																	</span>
																) : null}
															<span className="inline-flex border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
																	{provider.authType === "oauth" ? "Subscription" : "API key"}
																</span>
																{provider.supportsOAuth ? (
																	<span className="inline-flex border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
																		Pi login
																	</span>
																) : null}
																{provider.supportsApiKey ? (
																	<span className="inline-flex border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
																		API key
																	</span>
																) : null}
															</div>
														</div>
														<p className="mt-3 text-[0.8rem] text-slate-400 font-semibold">
															{provider.models.length > 0
																? `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} indexed.`
																: "No available models listed. Check your Apreal login status."}
														</p>
														{provider.supportsOAuth || provider.supportsApiKey ? (
															<div className="mt-3 flex flex-wrap items-center gap-2.5">
																<span className="text-[0.78rem] font-medium text-slate-500">
																	{provider.loginState.status === "pending"
																		? "Browser login is waiting for completion."
																		: provider.loginState.status === "failed"
																			? provider.loginState.error ?? "Provider login failed."
																			: provider.loginState.status === "succeeded"
																				? "Provider login completed. Your models are ready to refresh."
																				: "Use Pi login to authorize this provider in the browser."}
																</span>
																<div className="flex flex-wrap items-center gap-2">
																	{provider.supportsOAuth ? (
																		<button
																			type="button"
																			className="border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
																			onClick={() => {
																				void handleStartLogin(provider.id);
																			}}
																			disabled={authActionProviderId !== null || provider.loginState.status === "pending"}
																		>
																			{authActionProviderId === provider.id && provider.loginState.status !== "pending"
																				? "Opening..."
																				: provider.loginState.status === "pending"
																					? "Awaiting Browser"
																					: "Login with Provider"}
																		</button>
																	) : null}
																	{provider.supportsApiKey ? (
																		<button
																			type="button"
																			className="border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
																			onClick={() => {
																				setApiKeyEditorProviderId((current) => current === provider.id ? null : provider.id);
																				setProviderAuthError(null);
																			}}
																			disabled={authActionProviderId !== null}
																		>
																			{apiKeyEditorProviderId === provider.id ? "Hide API Key" : "Use API Key"}
																		</button>
																	) : null}
																</div>
															</div>
														) : null}
														{provider.supportsApiKey && apiKeyEditorProviderId === provider.id ? (
															<div className="mt-3 border border-slate-200 bg-slate-50 p-3">
																<label className="block">
																	<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">
																		Stored API key
																	</span>
																	<input
																		type="password"
																		value={apiKeyDrafts[provider.id] ?? ""}
																		onChange={(event) => {
																			const nextValue = event.target.value;
																			setApiKeyDrafts((previous) => ({ ...previous, [provider.id]: nextValue }));
																		}}
																		placeholder="Paste API key"
																		className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500"
																		autoComplete="off"
																		spellCheck={false}
																	/>
																</label>
																<div className="mt-3 flex flex-wrap items-center gap-2">
																	<button
																		type="button"
																		className="border border-black bg-black px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
																		onClick={() => {
																			void handleSaveApiKey(provider.id);
																		}}
																		disabled={authActionProviderId !== null}
																	>
																		{authActionProviderId === provider.id ? "Saving..." : "Save API Key"}
																	</button>
																	<span className="text-[0.76rem] font-medium text-slate-500">
																		Saved locally into your Apreal auth store for this machine.
																	</span>
																</div>
															</div>
														) : null}
													</li>
												);
											})}
													</ul>
												</section>
											</div>
											{visibleProviders.length === 0 ? (
												<p className="border border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-500 text-center">
													No providers match "{providerQuery.trim()}".
												</p>
											) : null}
										</div>
									) : null}

									{!providers && !providersError ? (
										<p className="mt-4 text-sm text-slate-400 font-semibold text-center">Reading system models...</p>
									) : null}
								</div>
							</div>
						)}

						{activeSection === "skills" && (
							<div className="space-y-4">
								<div className="border border-black/8 bg-white p-5">
									<div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Pi SDK skills</p>
											<h2 className="mt-1 text-base font-bold text-slate-900">Current skill inventory</h2>
										</div>
										{renderStatusPill(`${availableSkills.length} loaded`, availableSkills.length > 0 ? "success" : "neutral")}
									</div>

									<p className="mt-4 text-[0.84rem] leading-[1.6] text-slate-600">
										These are the currently discoverable Pi skills for this Apreal workspace and agent environment.
									</p>

									{availableSkills.length === 0 ? (
										<p className="mt-4 border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">
											No skills are currently available.
										</p>
									) : (
										<div className="mt-5 grid gap-3 min-[980px]:grid-cols-2">
											{availableSkills.map((skill) => (
												<article key={`${skill.name}:${skill.location}`} className="border border-slate-200 bg-slate-50 p-4">
													<div className="flex items-start justify-between gap-3">
														<div className="min-w-0">
															<h3 className="text-[0.96rem] font-bold text-slate-900">{skill.name}</h3>
															<p className="mt-2 text-[0.82rem] leading-[1.55] text-slate-600">
																{skill.description}
															</p>
														</div>
														<span className={`shrink-0 border px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] ${getSkillToneClassName(skill.source)}`}>
															{skill.sourceLabel}
														</span>
													</div>
													<div className="mt-4 border-t border-slate-200 pt-3">
														<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Source path</p>
														<p className="mt-1 break-all text-[0.76rem] leading-[1.55] text-slate-700 font-mono">
															{skill.location}
														</p>
													</div>
												</article>
											))}
										</div>
									)}
								</div>
							</div>
						)}

						{activeSection === "mcp" && (
							<div className="space-y-4">
								<div className="border border-black/8 bg-white p-5">
									<div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Model Context Protocol</p>
											<h2 className="mt-1 text-base font-bold text-slate-900">Manage MCP server definitions</h2>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<button
												type="button"
												className="border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
												onClick={onRefreshMcpServers}
												disabled={isLoadingMcpServers}
											>
												{isLoadingMcpServers ? "Syncing..." : "Sync MCP"}
											</button>
											{renderStatusPill(`${enabledMcpServerCount}/${mcpServers.length} active`, enabledMcpServerCount > 0 ? "success" : "neutral")}
										</div>
									</div>

									<p className="mt-4 text-[0.84rem] leading-[1.6] text-slate-600">
										Configured MCP servers are discovered by the local Apreal server and their tools become available to new chats automatically.
									</p>

									<div className="mt-4 grid gap-3 min-[720px]:grid-cols-3">
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Configured servers</p>
											<p className="mt-2 text-base font-bold text-slate-900">{mcpServers.length}</p>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Healthy connections</p>
											<p className="mt-2 text-base font-bold text-slate-900">{readyMcpServerCount}</p>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Discovered tools</p>
											<p className="mt-2 text-base font-bold text-slate-900">{mcpToolCount}</p>
										</div>
									</div>

									<p className="mt-3 text-[0.78rem] text-slate-500 font-medium">
										{enabledMcpServerCount} enabled server{enabledMcpServerCount === 1 ? "" : "s"}. Runtime health updates when the local server refreshes MCP tool discovery.
									</p>

									{mcpServersError ? (
										<p className="mt-4 border border-slate-300 bg-slate-100 p-3 text-[0.82rem] leading-[1.5] text-slate-800 font-medium">
											{mcpServersError}
										</p>
									) : null}
									{mcpFormMessage ? (
										<p className="mt-4 border border-slate-300 bg-white p-3 text-[0.82rem] leading-[1.5] text-slate-700 font-medium">
											{mcpFormMessage}
										</p>
									) : null}
									{mcpFormError ? (
										<p className="mt-4 border border-slate-300 bg-slate-100 p-3 text-[0.82rem] leading-[1.5] text-slate-800 font-medium">
											{mcpFormError}
										</p>
									) : null}

									<div className="mt-5 grid gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
										<form className="space-y-4 border border-slate-200 bg-[#fafaf8] p-4" onSubmit={handleSubmitMcpServer}>
											<div className="flex items-center justify-between gap-3">
												<div>
													<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-400">Editor</p>
													<h3 className="mt-1 text-[1rem] font-bold text-slate-900">{mcpEditingServerId ? "Edit MCP server" : "Add MCP server"}</h3>
												</div>
												{mcpEditingServerId ? (
													<button type="button" className="border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer" onClick={() => {
														resetMcpForm();
														setMcpFormError(null);
														setMcpFormMessage(null);
													}}>
														Cancel edit
													</button>
												) : null}
											</div>

											<label className="block">
												<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Display name</span>
												<input type="text" value={mcpName} onChange={(event) => setMcpName(event.target.value)} placeholder="filesystem" className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" autoComplete="off" spellCheck={false} />
											</label>

											<div className="grid gap-4 min-[640px]:grid-cols-[minmax(0,1fr)_auto]">
												<label className="block">
													<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Transport</span>
													<select value={mcpTransport} onChange={(event) => setMcpTransport(event.target.value as McpServerTransport)} className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] outline-none transition focus:border-slate-500">
														{MCP_TRANSPORT_OPTIONS.map((option) => (
															<option key={option.value} value={option.value}>{option.label}</option>
														))}
													</select>
													<p className="mt-2 text-[0.76rem] leading-[1.5] text-slate-500">{MCP_TRANSPORT_OPTIONS.find((option) => option.value === mcpTransport)?.description}</p>
												</label>
												<label className="flex items-end gap-2 pb-1">
													<input type="checkbox" checked={mcpEnabled} onChange={(event) => setMcpEnabled(event.target.checked)} className="h-4 w-4 border-slate-300" />
													<span className="text-sm font-semibold text-slate-700">Enabled</span>
												</label>
											</div>

											{mcpTransport === "stdio" ? (
												<>
													<label className="block">
														<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Command</span>
														<input type="text" value={mcpCommand} onChange={(event) => setMcpCommand(event.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem" className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" autoComplete="off" spellCheck={false} />
													</label>
													<label className="block">
														<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Arguments</span>
														<textarea value={mcpArgs} onChange={(event) => setMcpArgs(event.target.value)} placeholder="One argument per line" className="mt-2 min-h-28 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" spellCheck={false} />
													</label>
												</>
											) : (
												<label className="block">
													<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Server URL</span>
													<input type="url" value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://example.com/mcp" className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" autoComplete="off" spellCheck={false} />
												</label>
											)}

											<label className="block">
												<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Environment variables</span>
												<textarea value={mcpEnv} onChange={(event) => setMcpEnv(event.target.value)} placeholder="KEY=value" className="mt-2 min-h-28 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" spellCheck={false} />
											</label>

											{mcpTransport !== "stdio" ? (
												<label className="block">
													<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Request headers</span>
													<textarea value={mcpHeaders} onChange={(event) => setMcpHeaders(event.target.value)} placeholder="Authorization=Bearer ..." className="mt-2 min-h-28 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" spellCheck={false} />
												</label>
											) : null}

											<button type="submit" className="w-full border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer" disabled={mcpActionServerId !== null}>
												{mcpActionServerId === (mcpEditingServerId ?? "new") ? (mcpEditingServerId ? "Saving..." : "Creating...") : (mcpEditingServerId ? "Save MCP Server" : "Create MCP Server")}
											</button>
										</form>

										<section className="space-y-3">
											<div>
												<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-400">Inventory</p>
												<h3 className="mt-1 text-[1rem] font-bold text-slate-900">Stored MCP servers</h3>
											</div>

											{mcpServers.length === 0 ? (
												<p className="border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">No MCP servers configured yet.</p>
											) : (
												<ul className="space-y-2.5">
													{mcpServers.map((server) => {
														const isBusy = mcpActionServerId === server.id;
														return (
															<li key={server.id} className={`border p-4 ${server.enabled ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50"}`}>
																<div className="flex flex-wrap items-start justify-between gap-3">
																	<div className="min-w-0">
																		<div className="flex flex-wrap items-center gap-2">
																			<p className="text-[0.94rem] font-bold text-slate-900">{server.name}</p>
																			<span className={`border px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] ${server.enabled ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-500"}`}>{server.enabled ? "Enabled" : "Disabled"}</span>
																			<span className="border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-slate-500">{server.transport}</span>
																			{renderStatusPill(getMcpRuntimeLabel(server), getMcpRuntimeTone(server))}
																		</div>
																		<p className="mt-2 break-all font-mono text-[0.73rem] text-slate-500">
																			{server.transport === "stdio" ? `${server.command ?? "No command"}${server.args.length > 0 ? ` ${server.args.join(" ")}` : ""}` : server.url ?? "No URL"}
																		</p>
																	</div>
																	<div className="flex flex-wrap items-center gap-2">
																		<button type="button" className="border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer" onClick={() => handleEditMcpServer(server)} disabled={mcpActionServerId !== null}>Edit</button>
																		<button type="button" className="border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer" onClick={() => { void handleToggleMcpServer(server); }} disabled={mcpActionServerId !== null}>{isBusy ? "Saving..." : server.enabled ? "Disable" : "Enable"}</button>
																		<button type="button" className="border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer" onClick={() => { void handleDeleteSelectedMcpServer(server.id); }} disabled={mcpActionServerId !== null}>{isBusy ? "Deleting..." : "Delete"}</button>
																	</div>
																</div>
																<div className="mt-3 grid gap-3 text-[0.78rem] text-slate-600 min-[720px]:grid-cols-2">
																	<div>
																		<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-slate-400">Runtime</p>
																		<p className="mt-1">
																			{server.runtime?.toolCount ?? 0} tool{(server.runtime?.toolCount ?? 0) === 1 ? "" : "s"} discovered
																		</p>
																		{server.runtime?.lastError ? (
																			<p className="mt-1 text-slate-700">{server.runtime.lastError}</p>
																		) : null}
																	</div>
																	<div>
																		<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-slate-400">Environment</p>
																		<p className="mt-1">{Object.keys(server.env).length} variable{Object.keys(server.env).length === 1 ? "" : "s"}</p>
																	</div>
																	<div>
																		<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-slate-400">Headers</p>
																		<p className="mt-1">{Object.keys(server.headers).length} header{Object.keys(server.headers).length === 1 ? "" : "s"}</p>
																	</div>
																</div>
															</li>
														);
													})}
												</ul>
											)}
										</section>
									</div>
								</div>
							</div>
						)}

						{activeSection === "tools" && (
							<div className="space-y-4">
								<div className="border border-black/8 bg-white p-5">
									<div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Pi SDK tools</p>
											<h2 className="mt-1 text-base font-bold text-slate-900">Current tool inventory</h2>
										</div>
										{renderStatusPill(`${availableTools.length} enabled`, availableTools.length > 0 ? "success" : "neutral")}
									</div>

									<div className="mt-4 grid gap-3 min-[720px]:grid-cols-3">
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Default tools</p>
											<p className="mt-2 text-base font-bold text-slate-900">
												{availableTools.filter((tool) => tool.kind === "built_in").length}
											</p>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Custom tools</p>
											<p className="mt-2 text-base font-bold text-slate-900">
												{availableTools.filter((tool) => tool.kind === "custom").length}
											</p>
										</div>
										<div className="border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Workspace state</p>
											<p className="mt-2 text-base font-bold text-slate-900">
												{adminStatus ? "Live inventory" : "Unavailable"}
											</p>
										</div>
									</div>

									{availableTools.length === 0 ? (
										<p className="mt-4 border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">
											No tools are currently enabled.
										</p>
									) : (
										<div className="mt-5 overflow-hidden border border-slate-200 bg-[#fafaf8]">
											{availableTools.map((tool, index) => (
												<div
													key={tool.name}
													className={`grid gap-3 px-4 py-3.5 min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[760px]:items-start ${
														index > 0 ? "border-t border-slate-200" : ""
													}`}
												>
													<div className="min-w-0">
														<p className="text-[0.94rem] font-bold text-slate-900">{tool.label}</p>
														<p className="mt-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-400">
															Tool name: {tool.name}
														</p>
														<p className="mt-2 text-[0.82rem] leading-[1.55] text-slate-600">
															{tool.description}
														</p>
													</div>
													<span className={`shrink-0 border px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] ${getToolToneClassName(tool.kind)}`}>
														{getToolKindLabel(tool.kind)}
													</span>
												</div>
											))}
										</div>
									)}
								</div>
							</div>
						)}

						{/* ---------- JOBS SECTION ---------- */}
						{activeSection === "jobs" && (
							<JobsPanel
								adminStatus={adminStatus}
								jobs={jobs}
								jobRuns={jobRuns}
								sessionCache={sessionCache}
								jobsError={jobsError}
								jobRunsError={jobRunsError}
								isLoadingJobs={isLoadingJobs}
								isLoadingJobRuns={isLoadingJobRuns}
								connectionError={connectionError}
								onRefreshJobs={onRefreshJobs}
								onRefreshJobRuns={onRefreshJobRuns}
								onUpdateJobInterval={onUpdateJobInterval}
								onToggleJobEnabled={onToggleJobEnabled}
								onDeleteJob={onDeleteJob}
								onEnsureRunLoaded={onEnsureRunLoaded}
							/>
						)}
					</div>
						</div>
					</div>
				</div>
			</main>
		);
	}
