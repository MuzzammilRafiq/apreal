import type { AvailableSkill, AvailableTool, McpServerConfig, McpServerTransport, ProvidersResponse } from "@apreal/shared";
import type { SettingsSectionId } from "../runtime";

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
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

export function formatProviderId(id: string): string {
	return PROVIDER_DISPLAY_NAMES[id] ?? id;
}

export type SearchableModel = {
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

export function buildSearchableModels(providers: ProvidersResponse | null): SearchableModel[] {
	if (!providers) {
		return [];
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
}

export type SearchableProvider = {
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

export const DEFAULT_VISIBLE_PROVIDER_COUNT = 8;

export function normalizeSearchValue(value: string): string {
	return value.trim().toLowerCase();
}

type StatusPillProps = {
	label: string;
	tone: "neutral" | "success" | "danger";
};

export function StatusPill({ label, tone }: StatusPillProps) {
	const toneClassName = tone === "success"
		? "border-slate-300 bg-white text-slate-800 font-semibold"
		: tone === "danger"
			? "border-slate-400 bg-slate-100 text-slate-800 font-semibold"
			: "border-slate-300 bg-black/3 text-slate-600 font-semibold";

	return (
		<span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.63rem] uppercase tracking-[0.12em] ${toneClassName}`}>
			{tone === "success" && <span className="h-1.5 w-1.5 rounded-full bg-slate-800" />}
			{label}
		</span>
	);
}

export type SettingsSection = SettingsSectionId;

export const SECTIONS: { id: SettingsSection; label: string }[] = [
	{ id: "account", label: "Account" },
	{ id: "models", label: "Model control" },
	{ id: "skills", label: "Skills" },
	{ id: "mcp", label: "MCP" },
	{ id: "tools", label: "Tools" },
	{ id: "jobs", label: "Schedules & jobs" },
];

export const SECTION_TITLES: Record<SettingsSection, string> = {
	account: "Account",
	connection: "Account",
	models: "Model configuration",
	skills: "Available skills",
	mcp: "MCP servers",
	tools: "Available tools",
	jobs: "Scheduled automated tasks",
};

export const MCP_TRANSPORT_OPTIONS: { value: McpServerTransport; label: string; description: string }[] = [
	{ value: "stdio", label: "stdio", description: "Launches a local process from this machine." },
	{ value: "http", label: "http", description: "Connects to a remote MCP server over HTTP." },
	{ value: "sse", label: "sse", description: "Connects to a remote MCP server over Server-Sent Events." },
];

export function parseLineSeparatedList(value: string): string[] {
	return value
		.split(/\r?\n/)
		.flatMap((entry) => {
			const trimmedEntry = entry.trim();
			return trimmedEntry ? [trimmedEntry] : [];
		});
}

export function parseKeyValueText(value: string, label: string): Record<string, string> {
	const record: Record<string, string> = {};
	for (const line of value.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		const entryMatch = /^([^=]+)=(.*)$/.exec(trimmed);
		if (!entryMatch) {
			throw new Error(`${label} entries must use KEY=VALUE format.`);
		}

		const [, rawKey = "", entryValue = ""] = entryMatch;
		const key = rawKey.trim();
		if (!key) {
			throw new Error(`${label} keys must be non-empty.`);
		}

		record[key] = entryValue;
	}

	return record;
}

export function stringifyKeyValueRecord(record: Record<string, string>): string {
	return Object.entries(record)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

export function getMcpRuntimeTone(server: McpServerConfig): "neutral" | "success" | "danger" {
	const state = server.runtime?.state;
	if (state === "ready") {
		return "success";
	}
	if (state === "error") {
		return "danger";
	}
	return "neutral";
}

export function getMcpRuntimeLabel(server: McpServerConfig): string {
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

export function getToolToneClassName(kind: AvailableTool["kind"]): string {
	return kind === "built_in"
		? "border-slate-300 bg-white text-slate-700"
		: "border-emerald-300 bg-emerald-50 text-emerald-800";
}

export function getToolKindLabel(kind: AvailableTool["kind"]): string {
	return kind === "built_in" ? "Default" : "Custom";
}

export function getSkillToneClassName(source: AvailableSkill["source"]): string {
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

export function SectionIcon({ section }: { section: SettingsSection }) {
	if (section === "account") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<circle cx="12" cy="8" r="4" />
				<path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
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
