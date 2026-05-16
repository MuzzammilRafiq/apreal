import { useMemo, useState } from "react";
import type { LocalWebAdminStatus, ProvidersResponse } from "@apreal/shared";
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

function normalizeSearchValue(value: string): string {
	return value.trim().toLowerCase();
}

type SettingsPageProps = {
	adminStatus: LocalWebAdminStatus | null;
	statusError: string | null;
	providers: ProvidersResponse | null;
	providersError: string | null;
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
	onSubmitPairingCode: (pairingCode: string) => void;
};

function renderStatusPill(label: string, tone: "neutral" | "success" | "danger") {
	const toneClassName = tone === "success"
		? "border-accent-line bg-accent-soft text-accent"
		: tone === "danger"
			? "border-danger-line bg-danger-soft text-danger"
			: "border-line bg-ink-soft text-muted";

	return (
		<span className={`inline-flex border px-2.5 py-1 font-mono text-[0.69rem] uppercase tracking-[0.12em] ${toneClassName}`}>
			{label}
		</span>
	);
}

function getRelayTone(value: boolean): "success" | "danger" {
	return value ? "success" : "danger";
}

type SettingsSection = "server" | "relay" | "models" | "jobs";

const SECTIONS: { id: SettingsSection; label: string; description: string }[] = [
	{ id: "server", label: "Server", description: "Runtime and process" },
	{ id: "relay", label: "Relay", description: "Pairing and transport" },
	{ id: "models", label: "Models", description: "Providers and defaults" },
	{ id: "jobs", label: "Jobs", description: "Scheduled tasks" },
];

function SectionIcon({ section }: { section: SettingsSection }) {
	if (section === "server") {
		return (
			<svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
				<rect x="2" y="3" width="12" height="10" rx="1.5" />
				<path d="M5 7.5h6M5 10.5h4" strokeLinecap="round" />
			</svg>
		);
	}
	if (section === "relay") {
		return (
			<svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
				<path d="M2.5 8a5.5 5.5 0 0 1 10.22-2.17M13.5 8a5.5 5.5 0 0 1-10.22 2.17M8 2.5v2M8 11.5v2" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (section === "jobs") {
		return (
			<svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
				<circle cx="8" cy="8" r="5.5" />
				<path d="M8 5v3.5l2 1" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	return (
		<svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
			<path d="M2.5 11.5V8.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3M5.5 6.5v-2a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v2" strokeLinecap="round" />
			<circle cx="8" cy="10.5" r="1.5" />
		</svg>
	);
}

export function SettingsPage({
	adminStatus,
	statusError,
	providers,
	providersError,
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
	onSubmitPairingCode,
}: SettingsPageProps) {
	const [activeSection, setActiveSection] = useState<SettingsSection>("server");
	const [pairingCode, setPairingCode] = useState("");
	const [modelQuery, setModelQuery] = useState("");
	const [modelUpdateError, setModelUpdateError] = useState<string | null>(null);
	const [modelUpdateMessage, setModelUpdateMessage] = useState<string | null>(null);
	const [savingModelKey, setSavingModelKey] = useState<string | null>(null);

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

	const isOnline = Boolean(adminStatus);
	const relayReady = Boolean(adminStatus?.relayReady);

	return (
		<main className="min-h-svh bg-canvas text-ink">
			<div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 py-5 min-[860px]:px-6 min-[1180px]:px-8">
				{/* ---- Header ---- */}
				<header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
					<div>
						<p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-muted">
							{activeSection === "jobs" ? "Job Dashboard" : "Server settings"}
						</p>
						<h1 className="mt-2 text-[1.75rem] font-semibold tracking-[-0.03em] leading-tight">
							{activeSection === "server" && "Local server control"}
							{activeSection === "relay" && "Relay pairing"}
							{activeSection === "models" && "Model configuration"}
							{activeSection === "jobs" && "Scheduled jobs"}
						</h1>
						<p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">
							{activeSection === "server" && "The browser talks to the local server directly. Relay actions stay here as explicit server controls, while agent provider login stays in the Pi CLI on this machine."}
							{activeSection === "relay" && "Manage relay pairing and transport connection to the remote relay server."}
							{activeSection === "models" && "Choose the default model for new chats and view available providers."}
							{activeSection === "jobs" && "Manage schedules, inspect run history, and review execution transcripts."}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{activeSection === "jobs" ? (
							<button
								type="button"
								className="inline-flex items-center gap-2 border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
								onClick={onRefreshJobs}
							>
								<svg className={`h-4 w-4 ${isLoadingJobs ? "animate-spin" : ""}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M2.5 8a5.5 5.5 0 0 1 10.22-2.17M13.5 8a5.5 5.5 0 0 1-10.22 2.17M8 2.5v2M8 11.5v2" />
								</svg>
								{isLoadingJobs ? "Refreshing..." : "Refresh"}
							</button>
						) : (
							<button
								type="button"
								className="inline-flex items-center gap-2 border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
								onClick={onRefresh}
							>
								<svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M2.5 8a5.5 5.5 0 0 1 10.22-2.17M13.5 8a5.5 5.5 0 0 1-10.22 2.17M8 2.5v2M8 11.5v2" />
								</svg>
								Refresh status
							</button>
						)}
						<button
							type="button"
							className="border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-sidebar-ink transition hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onBack}
						>
							Back to chat
						</button>
					</div>
				</header>

				{/* ---- Server status strip ---- */}
				<div className="mt-5 flex flex-wrap items-center gap-3 border border-line bg-surface px-4 py-3 text-sm">
					<span className="inline-flex items-center gap-1.5 font-mono text-[0.69rem] uppercase tracking-[0.1em] text-muted">
						<span className={`inline-block h-2 w-2 rounded-full ${isOnline ? "bg-accent" : "bg-danger"}`} />
						{isOnline ? `Server :${adminStatus?.port ?? ""}` : "Server offline"}
					</span>
					<span className="text-line-strong">·</span>
					<span className="font-mono text-[0.69rem] uppercase tracking-[0.1em] text-muted">
						{relayReady ? "Relay paired" : "Awaiting relay"}
					</span>
					<span className="text-line-strong">·</span>
					<span className="font-mono text-[0.69rem] uppercase tracking-[0.1em] text-muted">
						{adminStatus?.relayTransportConnected ? "Transport connected" : "Transport idle"}
					</span>
				</div>

				{/* ---- Main layout: sidebar + content ---- */}
				<div className="mt-5 grid flex-1 gap-5 min-[961px]:grid-cols-[220px_minmax(0,1fr)]">
					{/* ======== SIDEBAR ======== */}
					<nav className="flex flex-col gap-1">
						{/* Mobile: horizontal scroll tabs */}
						<div className="flex gap-2 overflow-x-auto pb-1 min-[961px]:hidden">
							{SECTIONS.map((section) => (
								<button
									key={section.id}
									type="button"
									onClick={() => setActiveSection(section.id)}
									className={`flex shrink-0 items-center gap-2 border px-3.5 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
										activeSection === section.id
											? "border-ink bg-ink text-sidebar-ink"
											: "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-strong"
									}`}
								>
									<SectionIcon section={section.id} />
									{section.label}
								</button>
							))}
						</div>

						{/* Desktop: vertical sidebar */}
						<div className="hidden flex-col gap-1 min-[961px]:flex">
							<p className="px-3 pb-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
								Sections
							</p>
							{SECTIONS.map((section) => (
								<button
									key={section.id}
									type="button"
									onClick={() => setActiveSection(section.id)}
									className={`flex items-center gap-3 border-l-2 px-3 py-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
										activeSection === section.id
											? "border-l-ink bg-ink-soft"
											: "border-l-transparent hover:bg-ink-soft/50"
									}`}
								>
									<span className={activeSection === section.id ? "text-ink" : "text-muted"}>
										<SectionIcon section={section.id} />
									</span>
									<div className="min-w-0">
										<p className={`text-sm font-medium ${activeSection === section.id ? "text-ink" : "text-muted"}`}>
											{section.label}
										</p>
										<p className="text-[0.72rem] leading-4 text-faint">
											{section.description}
										</p>
									</div>
								</button>
							))}
						</div>
					</nav>

					{/* ======== CONTENT ======== */}
					<div className="space-y-5">
						{/* ---------- SERVER SECTION ---------- */}
						{activeSection === "server" && (
							<div className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]">
								<div className="flex items-center justify-between gap-3">
									<div>
										<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Server runtime</p>
										<h2 className="mt-2 text-xl font-semibold">Current process</h2>
									</div>
									{adminStatus ? renderStatusPill("Online", "success") : renderStatusPill("Offline", "danger")}
								</div>

								{statusError ? (
									<p className="mt-4 border border-danger-line bg-danger-soft px-3 py-3 text-sm leading-6 text-danger">
										{statusError}
									</p>
								) : null}

								<dl className="mt-5 grid gap-4 text-sm leading-6 min-[700px]:grid-cols-2">
									<div className="border border-line bg-surface-strong px-4 py-4">
										<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Port</dt>
										<dd className="mt-2 text-base font-medium text-ink">{adminStatus?.port ?? "Unavailable"}</dd>
									</div>
									<div className="border border-line bg-surface-strong px-4 py-4">
										<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Agent id</dt>
										<dd className="mt-2 break-all text-base font-medium text-ink">{adminStatus?.agentId ?? "Not registered"}</dd>
									</div>
									<div className="border border-line bg-surface-strong px-4 py-4 min-[700px]:col-span-2">
										<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Workspace</dt>
										<dd className="mt-2 break-all text-sm text-ink">{adminStatus?.cwd ?? "Unavailable"}</dd>
									</div>
									<div className="border border-line bg-surface-strong px-4 py-4 min-[700px]:col-span-2">
										<dt className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Web UI assets</dt>
										<dd className="mt-2 text-sm text-ink">
											{adminStatus?.webUiReady ? "Ready" : "Missing build output"}
											{adminStatus?.webUiPath ? ` · ${adminStatus.webUiPath}` : ""}
										</dd>
									</div>
								</dl>
							</div>
						)}

						{/* ---------- RELAY SECTION ---------- */}
						{activeSection === "relay" && (
							<div className="space-y-5">
								<div className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]">
									<div className="flex items-center justify-between gap-3">
										<div>
											<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Relay</p>
											<h2 className="mt-2 text-xl font-semibold">Pairing and transport</h2>
										</div>
										{renderStatusPill(adminStatus?.relayReady ? "Paired" : "Needs auth", getRelayTone(Boolean(adminStatus?.relayReady)))}
									</div>

									<div className="mt-5 grid gap-4 min-[700px]:grid-cols-2">
										<div className="border border-line bg-surface-strong px-4 py-4">
											<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Relay auth</p>
											<p className="mt-2 text-base font-medium text-ink">{adminStatus?.relayReady ? "Available" : "Not ready"}</p>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4">
											<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Relay transport</p>
											<p className="mt-2 text-base font-medium text-ink">
												{adminStatus?.relayTransportConnected ? "Connected" : "Idle or reconnecting"}
											</p>
										</div>
										<div className="border border-line bg-surface-strong px-4 py-4 min-[700px]:col-span-2">
											<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Relay URL</p>
											<p className="mt-2 break-all text-sm text-ink">{adminStatus?.relayUrl ?? "Unavailable"}</p>
										</div>
										{adminStatus?.relayStartupError ? (
											<div className="border border-danger-line bg-danger-soft px-4 py-4 min-[700px]:col-span-2">
												<p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-danger">Startup error</p>
												<p className="mt-2 text-sm leading-6 text-danger">{adminStatus.relayStartupError}</p>
											</div>
										) : null}
									</div>
								</div>

								<form className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]" onSubmit={handleSubmit}>
									<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Reauthenticate</p>
									<h2 className="mt-2 text-xl font-semibold">Enter a new pairing code</h2>
									<p className="mt-2 text-sm leading-6 text-muted">
										Generate a code from the relay-facing client, then submit it here to update the server without touching the terminal.
									</p>

									<label className="mt-5 block">
										<span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">Pairing code</span>
										<input
											type="text"
											value={pairingCode}
											onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
											placeholder="ABC123"
											className="mt-2 w-full border border-line bg-surface-strong px-3 py-3 font-mono text-base tracking-[0.18em] text-ink outline-none transition focus:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
											autoComplete="off"
											autoCapitalize="characters"
											spellCheck={false}
										/>
									</label>

									<button
										type="submit"
										className="mt-4 w-full border border-ink bg-ink px-4 py-3 text-sm font-medium text-sidebar-ink transition hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45"
										disabled={isSubmitting || pairingCode.trim().length === 0}
									>
										{isSubmitting ? "Updating relay pairing..." : "Reauthenticate relay"}
									</button>

									{submissionMessage ? (
										<p className="mt-4 border border-accent-line bg-accent-soft px-3 py-3 text-sm leading-6 text-accent">
											{submissionMessage}
										</p>
									) : null}
									{submissionError ? (
										<p className="mt-4 border border-danger-line bg-danger-soft px-3 py-3 text-sm leading-6 text-danger">
											{submissionError}
										</p>
									) : null}
								</form>
							</div>
						)}

						{/* ---------- MODELS SECTION ---------- */}
						{activeSection === "models" && (
							<div className="space-y-5">
								<div className="border border-line bg-surface px-5 py-5 shadow-[0_12px_40px_rgba(23,21,18,0.05)]">
									<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted">Agent providers</p>
									<h2 className="mt-2 text-xl font-semibold">Choose default model</h2>
									<p className="mt-3 text-sm leading-6 text-muted">
										Login is managed via the Pi CLI. Run <code className="font-mono text-ink">pi /login</code> to add a
										subscription, then <code className="font-mono text-ink">pi /model</code> to pick a default.
									</p>

									{providersError ? (
										<p className="mt-4 border border-danger-line bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">
											{providersError}
										</p>
									) : null}

									{providers && providers.providers.length === 0 ? (
										<p className="mt-4 text-sm text-muted">
											No providers configured yet.
										</p>
									) : null}

									{providers && providers.providers.length > 0 ? (
										<div className="mt-5 space-y-4">
											<div className="border border-line bg-surface-strong px-4 py-4">
												<label className="block">
													<span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted">
														Search models
													</span>
													<input
														type="search"
														value={modelQuery}
														onChange={(event) => setModelQuery(event.target.value)}
														placeholder="Search by model, id, or provider"
														className="mt-2 w-full border border-line bg-surface px-3 py-3 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
														autoComplete="off"
														spellCheck={false}
													/>
												</label>

												<p className="mt-3 text-xs leading-5 text-muted">
													{currentDefaultModel
														? normalizedModelQuery
															? `Showing ${visibleModels.length} match${visibleModels.length === 1 ? "" : "es"}. A default model is configured for new chats.`
															: "Showing the current default model for new chats."
														: normalizedModelQuery
															? `Showing ${visibleModels.length} match${visibleModels.length === 1 ? "" : "es"}. No default model is selected yet.`
															: "No default model is selected yet. Search to browse available models."}
												</p>

												{modelUpdateMessage ? (
													<p className="mt-3 border border-accent-line bg-accent-soft px-3 py-2 text-xs leading-5 text-accent">
														{modelUpdateMessage}
													</p>
												) : null}
												{modelUpdateError ? (
													<p className="mt-3 border border-danger-line bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">
														{modelUpdateError}
													</p>
												) : null}

												{visibleModels.length > 0 ? (
													<ul className="mt-4 space-y-2">
														{visibleModels.map((model) => {
															const isSaving = savingModelKey === model.key;
															return (
																<li
																	key={model.key}
																	className={`grid gap-3 border px-4 py-4 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-center ${
																		model.isDefault ? "border-accent-line bg-accent-soft/60" : "border-line bg-surface"
																	}`}
																>
																	<div className="min-w-0 flex-1">
																		<p className="text-sm font-medium text-ink">{model.label}</p>
																		<p className="mt-1 break-words text-[0.72rem] leading-5 text-muted">
																			{model.modelId} · {model.providerLabel} · {model.authType === "oauth" ? "Subscription" : "API key"}
																		</p>
																	</div>
																	<button
																		type="button"
																		className={`min-w-28 border px-4 py-2 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 min-[560px]:justify-self-end ${
																			model.isDefault
																				? "border-accent-line bg-accent-soft text-accent"
																				: "border-line bg-surface-strong text-ink hover:border-line-strong hover:bg-surface-muted"
																			}`}
																		onClick={() => {
																			void handleSelectModel(model.providerId, model.modelId);
																		}}
																		disabled={isSaving || model.isDefault || savingModelKey !== null}
																		>
																			{isSaving ? "Saving..." : model.isDefault ? "Current" : "Use model"}
																		</button>
																</li>
															);
														})}
													</ul>
												) : (
													<p className="mt-4 text-sm text-muted">
														{normalizedModelQuery
															? `No available models match "${modelQuery.trim()}".`
															: currentDefaultModel
																? "The current default model is shown above."
																: "No default model is selected yet. Search to browse available models."}
													</p>
												)}
											</div>

											<ul className="space-y-3">
											{providers.providers.map((provider) => {
												const isDefaultProvider = provider.id === providers.defaultProvider && provider.models.some((m) =>
													m.id === providers.defaultModel
												);
												return (
													<li
														key={provider.id}
														className={`border px-4 py-3 ${
															isDefaultProvider ? "border-accent-line bg-accent-soft/40" : "border-line bg-surface-strong"
														}`}
													>
														<div className="flex flex-wrap items-start justify-between gap-2">
															<div className="min-w-0">
																<p className="text-sm font-medium text-ink">{formatProviderId(provider.id)}</p>
																<p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted">
																	{provider.id}
																</p>
															</div>
															<div className="flex flex-wrap items-center gap-1.5">
																{isDefaultProvider ? (
																	<span className="inline-flex border border-accent-line bg-accent-soft px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-accent">
																		Default
																	</span>
																) : null}
																<span className="inline-flex border border-line bg-ink-soft px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted">
																	{provider.authType === "oauth" ? "Subscription" : "API key"}
																</span>
															</div>
														</div>
														<p className="mt-3 text-xs text-muted">
															{provider.models.length > 0
																? `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} available for search.`
																: "No available models (auth may be expired)."}
														</p>
													</li>
												);
											})}
											</ul>
										</div>
									) : null}

									{!providers && !providersError ? (
										<p className="mt-4 text-sm text-muted">Loading…</p>
									) : null}
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
		</main>
	);
}
