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

function getRelayTone(value: boolean): "success" | "danger" {
	return value ? "success" : "danger";
}

type SettingsSection = "server" | "relay" | "models" | "jobs";

const SECTIONS: { id: SettingsSection; label: string; description: string }[] = [
	{ id: "server", label: "Server runtime", description: "Process & environments" },
	{ id: "relay", label: "Relay gateway", description: "Pairing & communication" },
	{ id: "models", label: "Model control", description: "Providers & default models" },
	{ id: "jobs", label: "Schedules & jobs", description: "Automated agent tasks" },
];

function SectionIcon({ section }: { section: SettingsSection }) {
	if (section === "server") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<rect x="2" y="3" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
				<line x1="8" y1="21" x2="16" y2="21" strokeLinecap="round" strokeLinejoin="round" />
				<line x1="12" y1="17" x2="12" y2="21" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		);
	}
	if (section === "relay") {
		return (
			<svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
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
		<main className="min-h-svh bg-[#f3f3f3] text-[#171717] selection:bg-black/10 selection:text-black">
			<div className="flex min-h-svh w-full flex-col px-4 py-6 min-[860px]:px-5 min-[1180px]:px-6 min-[1440px]:px-8">
				{/* ---- Header ---- */}
				<header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
					<div>
						<p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-[#64748b] font-bold">
							{activeSection === "jobs" ? "Recurring Job Dashboard" : "Workspace dashboard"}
						</p>
						<h1 className="mt-1.5 text-[1.6rem] font-bold tracking-tight leading-none text-slate-900">
							{activeSection === "server" && "Local server runtime"}
							{activeSection === "relay" && "Relay authentication"}
							{activeSection === "models" && "Model configuration"}
							{activeSection === "jobs" && "Scheduled automated tasks"}
						</h1>
						<p className="mt-2 max-w-2xl text-[0.84rem] leading-[1.55] text-[#525252] font-medium">
							{activeSection === "server" && "Control your local server process and monitor direct browser-to-server operations. Keep in mind that provider auth stays secured inside your Pi CLI."}
							{activeSection === "relay" && "Pair and authorize web transport layers to securely access remote server functions from external clients."}
							{activeSection === "models" && "Search available provider models on your machine and lock down the default model used for initiating new conversations."}
							{activeSection === "jobs" && "Configure recurring jobs, fine-tune execution intervals, view active state monitors, and review deep history traces."}
						</p>
					</div>
					<div className="flex items-center gap-2.5 shrink-0">
						{activeSection === "jobs" ? (
							<button
								type="button"
							className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-[#171717] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
								onClick={onRefreshJobs}
							>
								<svg className={`h-4 w-4 ${isLoadingJobs ? "animate-spin text-slate-700" : "text-[#525252]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M160 80A80 80 0 10240 160" />
									<path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8h-4.21" />
								</svg>
								{isLoadingJobs ? "Syncing..." : "Sync Jobs"}
							</button>
						) : (
							<button
								type="button"
							className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-[#171717] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
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
							className="inline-flex items-center gap-2 rounded-md border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
							onClick={onBack}
						>
							<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
								<path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
							</svg>
							Back to chat
						</button>
					</div>
				</header>

				{/* ---- Server status strip ---- */}
				<div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[0.8rem] font-medium text-slate-500">
					<span className="inline-flex items-center gap-2 font-mono text-[0.74rem] uppercase tracking-[0.1em] text-slate-400">
						<span className={`inline-block h-2 w-2 rounded-full ${isOnline ? "bg-slate-900" : "bg-slate-400"}`} />
						{isOnline ? `Server :${adminStatus?.port ?? ""}` : "Server offline"}
					</span>
					<span className="text-slate-300">|</span>
					<span className="font-mono text-[0.74rem] uppercase tracking-[0.1em]">
						Auth: <span className={relayReady ? "text-slate-800" : "text-slate-500"}>{relayReady ? "Paired" : "Awaiting Pairing"}</span>
					</span>
					<span className="text-slate-300">|</span>
					<span className="font-mono text-[0.74rem] uppercase tracking-[0.1em]">
						Transport: <span className={adminStatus?.relayTransportConnected ? "text-slate-800" : "text-slate-400"}>{adminStatus?.relayTransportConnected ? "Connected" : "Idle"}</span>
					</span>
				</div>

				{/* ---- Main layout: sidebar + content ---- */}
				<div className="mt-4 grid flex-1 gap-4 min-[961px]:grid-cols-[280px_minmax(0,1fr)] min-[1320px]:grid-cols-[320px_minmax(0,1fr)] min-[1600px]:grid-cols-[360px_minmax(0,1fr)]">
					{/* ======== SIDEBAR ======== */}
					<nav className="flex flex-col gap-3 min-[961px]:sticky min-[961px]:top-6 min-[961px]:self-start">
						{/* Mobile: horizontal scroll tabs */}
						<div className="flex gap-1.5 overflow-x-auto pb-1 min-[961px]:hidden scrollbar-thin">
							{SECTIONS.map((section) => (
								<button
									key={section.id}
									type="button"
									onClick={() => setActiveSection(section.id)}
									className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer ${
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
						<div className="hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm min-[961px]:flex min-[961px]:flex-col">
							<div className="border-b border-slate-200 px-2.5 pb-3">
								<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-[#64748b]">
									Workspace Tabs
								</p>
								<p className="mt-2 text-sm font-medium leading-[1.5] text-slate-500">
									Switch between runtime, relay, models, and jobs without losing space in the main panel.
								</p>
							</div>
							<div className="mt-3 flex flex-col gap-1">
								{SECTIONS.map((section) => (
									<button
										key={section.id}
										type="button"
										onClick={() => setActiveSection(section.id)}
										className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer ${
											activeSection === section.id
												? "border-slate-300 bg-slate-950 text-white"
												: "border-transparent bg-transparent hover:bg-slate-100"
										}`}
									>
										<span className={`mt-0.5 shrink-0 ${activeSection === section.id ? "text-white" : "text-[#64748b]"}`}>
											<SectionIcon section={section.id} />
										</span>
										<div className="min-w-0">
											<p className={`text-[0.88rem] font-bold leading-tight ${activeSection === section.id ? "text-white" : "text-slate-800"}`}>
												{section.label}
											</p>
											<p className={`mt-1 text-[0.76rem] leading-tight font-medium ${activeSection === section.id ? "text-slate-300" : "text-slate-400"}`}>
												{section.description}
											</p>
										</div>
									</button>
								))}
							</div>

							<div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-[0.8rem] font-medium text-slate-500">
								<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[#64748b]">
									Workspace Status
								</p>
								<div className="mt-3 space-y-2.5">
									<div className="flex items-center justify-between gap-3">
										<span className="font-mono text-[0.72rem] uppercase tracking-[0.1em] text-slate-400">Server</span>
										<span className="text-right font-semibold text-slate-700">
											{isOnline ? `Online :${adminStatus?.port ?? ""}` : "Offline"}
										</span>
									</div>
									<div className="flex items-center justify-between gap-3">
										<span className="font-mono text-[0.72rem] uppercase tracking-[0.1em] text-slate-400">Auth</span>
										<span className={`text-right font-semibold ${relayReady ? "text-slate-800" : "text-slate-500"}`}>
											{relayReady ? "Paired" : "Awaiting pairing"}
										</span>
									</div>
									<div className="flex items-center justify-between gap-3">
										<span className="font-mono text-[0.72rem] uppercase tracking-[0.1em] text-slate-400">Transport</span>
										<span className={`text-right font-semibold ${adminStatus?.relayTransportConnected ? "text-slate-800" : "text-slate-400"}`}>
											{adminStatus?.relayTransportConnected ? "Connected" : "Idle"}
										</span>
									</div>
								</div>
							</div>
						</div>
					</nav>

					{/* ======== CONTENT ======== */}
					<div className="min-w-0 space-y-4">
						{/* ---------- SERVER SECTION ---------- */}
						{activeSection === "server" && (
							<div className="rounded-lg border border-slate-200 bg-white p-4">
								<div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
									<div>
										<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Environment Node</p>
										<h2 className="mt-1 text-base font-bold text-slate-900">Current active process</h2>
									</div>
									{adminStatus ? renderStatusPill("Online", "success") : renderStatusPill("Offline", "danger")}
								</div>

								{statusError ? (
									<p className="mt-3 rounded-md border border-slate-300 bg-slate-100 p-3 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">
										{statusError}
									</p>
								) : null}

								<dl className="mt-4 grid gap-3 text-sm leading-[1.5] min-[700px]:grid-cols-2">
									<div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
										<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Active Port</dt>
										<dd className="mt-2 text-base font-bold text-slate-900 font-mono">{adminStatus?.port ?? "Unavailable"}</dd>
									</div>
									<div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
										<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Local Agent ID</dt>
										<dd className="mt-2 break-all text-[0.92rem] font-semibold text-slate-800 font-mono">{adminStatus?.agentId ?? "Not registered"}</dd>
									</div>
									<div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3 min-[700px]:col-span-2">
										<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Root Workspace CWD</dt>
										<dd className="mt-2 break-all text-[0.86rem] font-medium text-slate-700 font-mono">{adminStatus?.cwd ?? "Unavailable"}</dd>
									</div>
									<div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3 min-[700px]:col-span-2">
										<dt className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Web UI Build State</dt>
										<dd className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
											<span className="h-2 w-2 rounded-full bg-slate-900" />
											{adminStatus?.webUiReady ? "Ready (Vite compiler online)" : "Awaiting Vite compiler output"}
											{adminStatus?.webUiPath ? <span className="text-[#64748b] font-mono text-[0.78rem] font-normal"> · {adminStatus.webUiPath}</span> : ""}
										</dd>
									</div>
								</dl>
							</div>
						)}

						{/* ---------- RELAY SECTION ---------- */}
						{activeSection === "relay" && (
							<div className="space-y-4">
								<div className="rounded-lg border border-slate-200 bg-white p-4">
									<div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Network Transport</p>
										<h2 className="mt-1 text-base font-bold text-slate-900">Relay Gateway state</h2>
										</div>
										{renderStatusPill(adminStatus?.relayReady ? "Paired" : "Needs authentication", getRelayTone(Boolean(adminStatus?.relayReady)))}
									</div>

									<div className="mt-4 grid gap-3 min-[700px]:grid-cols-2">
										<div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Relay Pairing Authorized</p>
											<p className="mt-2 text-base font-bold text-slate-900">{adminStatus?.relayReady ? "Available (Security handshake OK)" : "Awaiting pair handshake"}</p>
										</div>
										<div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Web Transport Tunnel</p>
											<p className="mt-2 text-base font-bold text-slate-900">
												{adminStatus?.relayTransportConnected ? "Connected (Exposing local context)" : "Transport stream idle"}
											</p>
										</div>
										<div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3 min-[700px]:col-span-2">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Exposing Relay Gateway URL</p>
											<p className="mt-2 break-all text-[0.86rem] font-medium text-slate-700 font-mono">{adminStatus?.relayUrl ?? "Unavailable"}</p>
										</div>
										{adminStatus?.relayStartupError ? (
											<div className="rounded-md border border-slate-300 bg-slate-100 px-3.5 py-3 min-[700px]:col-span-2">
												<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-700">Tunnel Startup error</p>
												<p className="mt-2 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">{adminStatus.relayStartupError}</p>
											</div>
										) : null}
									</div>
								</div>

								<form className="rounded-lg border border-slate-200 bg-white p-4" onSubmit={handleSubmit}>
									<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Handshake</p>
									<h2 className="mt-1 text-base font-bold text-slate-900">Configure new pairing code</h2>
									<p className="mt-2 text-sm leading-[1.5] text-[#525252] font-medium">
										Have a pairing code from your relay client or external dashboard? Submit it here to re-authorize the server tunnel directly without terminal inputs.
									</p>

									<label className="mt-4 block">
										<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Six-character pairing code</span>
										<input
											type="text"
											value={pairingCode}
											onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
											placeholder="ABC123"
											className="mt-2 w-full rounded-md border border-slate-300 bg-[#f8f8f8] px-3 py-2.5 font-mono text-[1rem] font-bold tracking-[0.22em] text-[#171717] placeholder:text-slate-300 outline-none transition focus:border-slate-500 focus:bg-white"
											autoComplete="off"
											autoCapitalize="characters"
											spellCheck={false}
										/>
									</label>

									<button
										type="submit"
										className="mt-4 w-full flex items-center justify-center rounded-md border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
										disabled={isSubmitting || pairingCode.trim().length === 0}
									>
										{isSubmitting ? "Syncing handshake..." : "Reauthenticate & Sync pairing"}
									</button>

									{submissionMessage ? (
										<p className="mt-3 rounded-md border border-slate-300 bg-white p-3 text-[0.84rem] leading-[1.5] text-slate-700 font-medium">
											{submissionMessage}
										</p>
									) : null}
									{submissionError ? (
										<p className="mt-3 rounded-md border border-slate-300 bg-slate-100 p-3 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">
											{submissionError}
										</p>
									) : null}
								</form>
							</div>
						)}

						{/* ---------- MODELS SECTION ---------- */}
						{activeSection === "models" && (
							<div className="space-y-4">
								<div className="rounded-lg border border-slate-200 bg-white p-4">
									<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Agent Provisioning</p>
									<h2 className="mt-1 text-base font-bold text-slate-900">Set default intelligence model</h2>
									<p className="mt-2 text-sm leading-[1.5] text-[#525252] font-medium">
										Pi handles local subscriptions and credentials securely on your computer. Use <code className="rounded-sm bg-slate-100 px-1.5 py-0.5 font-mono text-slate-800 font-semibold">pi /login</code> in your terminal to sign in, and update your default model below.
									</p>

									{providersError ? (
										<p className="mt-3 rounded-md border border-slate-300 bg-slate-100 p-3 text-[0.82rem] leading-[1.5] text-slate-800 font-medium">
											{providersError}
										</p>
									) : null}

									{providers && providers.providers.length === 0 ? (
										<p className="mt-3 rounded-md border border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-500 text-center">
											No active providers configured yet.
										</p>
									) : null}

									{providers && providers.providers.length > 0 ? (
										<div className="mt-4 space-y-4">
											<div className="rounded-md border border-slate-200 bg-slate-50 p-4">
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
															className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500"
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
													{currentDefaultModel
														? normalizedModelQuery
															? `Showing ${visibleModels.length} match${visibleModels.length === 1 ? "" : "es"}. A default model is locking in.`
															: "Currently selected default model for initiating threads."
														: normalizedModelQuery
															? `Showing ${visibleModels.length} match${visibleModels.length === 1 ? "" : "es"}.`
															: "Type in the search field above to explore intelligence models on this system."}
												</p>

												{modelUpdateMessage ? (
													<p className="mt-2.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs leading-[1.5] text-slate-700 font-medium">
														{modelUpdateMessage}
													</p>
												) : null}
												{modelUpdateError ? (
													<p className="mt-2.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-xs leading-[1.5] text-slate-800 font-medium">
														{modelUpdateError}
													</p>
												) : null}

												{visibleModels.length > 0 ? (
													<ul className="mt-3.5 space-y-2">
														{visibleModels.map((model) => {
															const isSaving = savingModelKey === model.key;
															return (
																<li
																	key={model.key}
															className={`grid gap-2.5 rounded-md border p-3.5 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-center transition-colors ${
																model.isDefault
																	? "border-slate-300 bg-white"
																	: "border-slate-200 bg-white"
															}`}
																>
																	<div className="min-w-0 flex-1">
																		<p className="text-[0.92rem] font-bold text-slate-900">{model.label}</p>
																<p className="mt-1 break-all text-[0.72rem] leading-tight font-mono text-slate-500 font-medium">
																	ID: {model.modelId} · {model.providerLabel} · <span className="text-slate-600 font-bold">{model.authType === "oauth" ? "Subscription" : "Custom Key"}</span>
																		</p>
																	</div>
																	<button
																		type="button"
																className={`min-w-28 rounded-md border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 min-[560px]:justify-self-end cursor-pointer ${
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
													<p className="mt-3 text-sm font-semibold text-slate-500 text-center py-3">
														{normalizedModelQuery
															? `No available models match "${modelQuery.trim()}".`
															: "Use search query to find models."}
													</p>
												)}
											</div>

											<ul className="space-y-2.5">
											{providers.providers.map((provider) => {
												const isDefaultProvider = provider.id === providers.defaultProvider && provider.models.some((m) =>
													m.id === providers.defaultModel
												);
												return (
													<li
														key={provider.id}
													className={`rounded-md border p-3.5 ${
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
															<span className="inline-flex border border-slate-900 bg-slate-900 rounded-md px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-white">
																		Default provider
																	</span>
																) : null}
															<span className="inline-flex border border-slate-300 bg-white rounded-md px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
																	{provider.authType === "oauth" ? "Subscription" : "API key"}
																</span>
															</div>
														</div>
														<p className="mt-3 text-[0.8rem] text-slate-400 font-semibold">
															{provider.models.length > 0
																? `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} indexed.`
																: "No available models listed. Check your login status inside Pi CLI."}
														</p>
													</li>
												);
											})}
											</ul>
										</div>
									) : null}

									{!providers && !providersError ? (
										<p className="mt-4 text-sm text-slate-400 font-semibold text-center">Reading system models...</p>
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
