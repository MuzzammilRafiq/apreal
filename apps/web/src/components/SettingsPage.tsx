import { useMemo, useState } from "react";
import type { LocalWebAdminStatus, ProvidersResponse } from "@apreal/shared";

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
	onBack: () => void;
	onRefresh: () => void;
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

export function SettingsPage({
	adminStatus,
	statusError,
	providers,
	providersError,
	isSubmitting,
	submissionMessage,
	submissionError,
	onBack,
	onRefresh,
	onSetDefaultModel,
	onSubmitPairingCode,
}: SettingsPageProps) {
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

	return (
		<main className="min-h-svh bg-canvas text-ink">
			<div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-5 py-6 min-[860px]:px-8">
				<header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
					<div>
						<p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-muted">Server settings</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Local server control</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
							The browser talks to the local server directly. Relay actions stay here as explicit server controls, while agent provider login stays in the Pi CLI on this machine.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className="border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onRefresh}
						>
							Refresh status
						</button>
						<button
							type="button"
							className="border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-sidebar-ink transition hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onBack}
						>
							Back to chat
						</button>
					</div>
				</header>

				<div className="grid flex-1 gap-5 py-6 min-[961px]:grid-cols-[minmax(0,1.15fr)_minmax(420px,1.05fr)]">
					<section className="space-y-5">
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
					</section>

					<aside className="space-y-5">
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

						<div className="border border-white/10 bg-sidebar-bg px-5 py-5 text-sidebar-ink shadow-[0_12px_40px_rgba(23,21,18,0.12)]">
							<p className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-sidebar-muted">Agent providers</p>
							<h2 className="mt-2 text-xl font-semibold">Choose default model</h2>
							<p className="mt-3 text-sm leading-6 text-sidebar-muted">
								Login is managed via the Pi CLI. Run <code className="font-mono text-sidebar-ink">pi /login</code> to add a
								subscription, then <code className="font-mono text-sidebar-ink">pi /model</code> to pick a default.
							</p>

							{providersError ? (
								<p className="mt-4 border border-danger-line bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">
									{providersError}
								</p>
							) : null}

							{providers && providers.providers.length === 0 ? (
								<p className="mt-4 text-sm text-sidebar-muted">
									No providers configured yet.
								</p>
							) : null}

							{providers && providers.providers.length > 0 ? (
								<div className="mt-4 space-y-4">
									<div className="border border-white/10 bg-sidebar-panel px-4 py-4">
										<label className="block">
											<span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sidebar-muted">
												Search models
											</span>
											<input
												type="search"
												value={modelQuery}
												onChange={(event) => setModelQuery(event.target.value)}
												placeholder="Search by model, id, or provider"
												className="mt-2 w-full border border-white/12 bg-white/5 px-3 py-3 text-sm text-sidebar-ink outline-none transition placeholder:text-sidebar-muted/70 focus:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
												autoComplete="off"
												spellCheck={false}
											/>
										</label>

										<p className="mt-3 text-xs leading-5 text-sidebar-muted">
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
																model.isDefault ? "border-accent-line bg-white/6" : "border-white/10 bg-white/3"
															}`}
														>
															<div className="min-w-0 flex-1">
																<p className="text-sm font-medium text-sidebar-ink">{model.label}</p>
																<p className="mt-1 break-words text-[0.72rem] leading-5 text-sidebar-muted">
																	{model.modelId} · {model.providerLabel} · {model.authType === "oauth" ? "Subscription" : "API key"}
																</p>
															</div>
															<button
																type="button"
																className={`min-w-28 border px-4 py-2 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 min-[560px]:justify-self-end ${
																	model.isDefault
																		? "border-accent-line bg-accent-soft text-accent"
																		: "border-white/12 bg-white/5 text-sidebar-ink hover:border-white/25 hover:bg-white/8"
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
											<p className="mt-4 text-sm text-sidebar-muted">
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
													isDefaultProvider ? "border-accent-line bg-white/6" : "border-white/10 bg-sidebar-panel"
												}`}
											>
												<div className="flex flex-wrap items-start justify-between gap-2">
													<div className="min-w-0">
														<p className="text-sm font-medium text-sidebar-ink">{formatProviderId(provider.id)}</p>
														<p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sidebar-muted">
															{provider.id}
														</p>
													</div>
													<div className="flex flex-wrap items-center gap-1.5">
														{isDefaultProvider ? (
															<span className="inline-flex border border-accent-line bg-accent-soft px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-accent">
																Default
															</span>
														) : null}
														<span className="inline-flex border border-white/12 bg-white/5 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sidebar-muted">
															{provider.authType === "oauth" ? "Subscription" : "API key"}
														</span>
													</div>
												</div>
												<p className="mt-3 text-xs text-sidebar-muted">
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
								<p className="mt-4 text-sm text-sidebar-muted">Loading…</p>
							) : null}
						</div>
					</aside>
				</div>
			</div>
		</main>
	);
}
