import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AvailableSkill, AvailableTool, CreateMcpServerRequest, LocalWebAdminStatus, McpServerConfig, McpServerTransport, ProvidersResponse, UpdateMcpServerRequest } from "@apreal/shared";
import type { ScheduledJobDetails } from "../chatTypes";
import { ConnectionSidebarFooter } from "./ConnectionSidebarFooter";
import { ScheduledJobList } from "./ScheduledJobList";
import { SettingsModelsSection } from "./SettingsModelsSection";
import { SettingsInventorySections } from "./SettingsInventorySections";
import { SettingsMcpSection } from "./SettingsMcpSection";
import { SettingsAccountSection } from "./SettingsAccountSection";

import { DEFAULT_VISIBLE_PROVIDER_COUNT, MCP_TRANSPORT_OPTIONS, SECTIONS, SECTION_TITLES, SectionIcon, formatProviderId, getMcpRuntimeLabel, getMcpRuntimeTone, getSkillToneClassName, getToolKindLabel, getToolToneClassName, normalizeSearchValue, parseKeyValueText, parseLineSeparatedList, stringifyKeyValueRecord, type SearchableModel, type SearchableProvider, type SettingsSection } from "./settings-helpers";

type SettingsPageProps = {
	adminStatus: LocalWebAdminStatus | null;
	statusError: string | null;
	providers: ProvidersResponse | null;
	providersError: string | null;
	mcpServers: McpServerConfig[];
	mcpServersError: string | null;
	isLoadingMcpServers: boolean;
	isSavingAppendPrompt: boolean;
	appendPromptSubmissionMessage: string | null;
	appendPromptSubmissionError: string | null;
	jobs: ScheduledJobDetails[];
	jobsError: string | null;
	isLoadingJobs: boolean;
	connectionError: string | null;
	connected: boolean;
	serverReady: boolean;
	target: "local" | "remote";
	onBack: () => void;
	onRefreshJobs: () => void;
	onOpenJob: (jobId: string) => void;
	onSetDefaultModel: (provider: string, modelId: string) => Promise<void>;
	onStartProviderLogin: (provider: string) => Promise<void>;
	onSaveProviderApiKey: (provider: string, apiKey: string) => Promise<void>;
	onCreateMcpServer: (request: CreateMcpServerRequest) => Promise<void>;
	onUpdateMcpServer: (serverId: string, request: UpdateMcpServerRequest) => Promise<void>;
	onDeleteMcpServer: (serverId: string) => Promise<void>;
	onRefreshMcpServers: () => void;
	onSaveAppendSystemPrompt: (appendSystemPrompt: string) => void;
	visibleSections: SettingsSection[];
};

export function SettingsPage({
	adminStatus,
	statusError,
	providers,
	providersError,
	mcpServers,
	mcpServersError,
	isLoadingMcpServers,
	isSavingAppendPrompt,
	appendPromptSubmissionMessage,
	appendPromptSubmissionError,
	jobs,
	jobsError,
	isLoadingJobs,
	connectionError,
	connected,
	serverReady,
	target,
	onBack,
	onRefreshJobs,
	onOpenJob,
	onSetDefaultModel,
	onStartProviderLogin,
	onSaveProviderApiKey,
	onCreateMcpServer,
	onUpdateMcpServer,
	onDeleteMcpServer,
	onRefreshMcpServers,
	onSaveAppendSystemPrompt,
	visibleSections,
}: SettingsPageProps) {
	const [activeSection, setActiveSection] = useState<SettingsSection>(visibleSections[0] ?? "account");
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
	const [appendSystemPromptDraft, setAppendSystemPromptDraft] = useState(adminStatus?.appendSystemPrompt ?? "");
	const [appendSystemPromptDirty, setAppendSystemPromptDirty] = useState(false);

	useEffect(() => {
		if (!appendSystemPromptDirty) {
			setAppendSystemPromptDraft(adminStatus?.appendSystemPrompt ?? "");
		}
	}, [adminStatus?.appendSystemPrompt, appendSystemPromptDirty]);

	useEffect(() => {
		if (appendPromptSubmissionMessage) {
			setAppendSystemPromptDirty(false);
			setAppendSystemPromptDraft(adminStatus?.appendSystemPrompt ?? "");
		}
	}, [adminStatus?.appendSystemPrompt, appendPromptSubmissionMessage]);

	useEffect(() => {
		if (!visibleSections.includes(activeSection)) {
			setActiveSection(visibleSections[0] ?? "account");
		}
	}, [activeSection, visibleSections]);

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

	const handleAppendSystemPromptSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSaveAppendSystemPrompt(appendSystemPromptDraft);
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

	const handleSubmitMcpServer = async (event: FormEvent<HTMLFormElement>) => {
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

	const activeSectionTitle = SECTION_TITLES[activeSection];
	const availableSkills = adminStatus?.availableSkills ?? [];
	const availableTools = adminStatus?.availableTools ?? [];
	const enabledMcpServerCount = mcpServers.filter((server) => server.enabled).length;
	const readyMcpServerCount = mcpServers.filter((server) => server.runtime?.state === "ready").length;
	const mcpToolCount = mcpServers.reduce((total, server) => total + (server.runtime?.toolCount ?? 0), 0);
	const visibleSectionItems = SECTIONS.filter((section) => visibleSections.includes(section.id));

	useEffect(() => {
		if (!mobileMenuOpen) {
			return;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [mobileMenuOpen]);

	const refreshIcon = (isSpinning: boolean) => (
		<svg
			className={`h-4 w-4 ${isSpinning ? "animate-spin text-slate-700" : "text-[#525252]"}`}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2.2}
			aria-hidden="true"
		>
			<path d="M21 2v6h-6" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M3 12a9 9 0 0 1 15-6.7L21 8" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M3 22v-6h6" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M21 12a9 9 0 0 1-15 6.7L3 16" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);

	return (
		<main className="min-h-svh bg-[linear-gradient(180deg,#f7f6f2_0%,#f1f1ee_28%,#efefec_100%)] text-[#171717] selection:bg-black/10 selection:text-black">
			<div className="flex min-h-svh w-full flex-col">
				{/* ---- Main layout: sidebar + content ---- */}
				<div className="grid flex-1 grid-rows-[auto_minmax(0,1fr)] content-start min-[961px]:grid-cols-[280px_minmax(0,1fr)] min-[961px]:grid-rows-1 min-[1320px]:grid-cols-[300px_minmax(0,1fr)]">
					<div className="z-30 flex items-center justify-between gap-3 border-b border-black/8 bg-white/88 px-3 py-3 backdrop-blur-md min-[961px]:hidden">
						<button
							type="button"
							className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.045] text-slate-900 transition-colors duration-150 hover:bg-black/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
							onClick={() => setMobileMenuOpen(true)}
							aria-label="Open settings menu"
						>
							<svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2">
								<path d="M3.333 5h13.334M3.333 10h13.334M3.333 15h13.334" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</button>
						<div className="min-w-0 flex-1">
							<p className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-500">Settings</p>
							<p className="truncate text-[0.9rem] font-semibold tracking-tight text-slate-900">{activeSectionTitle}</p>
						</div>
					</div>

					{mobileMenuOpen ? (
						<div className="fixed inset-0 z-50 bg-black/40 min-[961px]:hidden" aria-hidden="true">
							<button
								type="button"
								className="absolute inset-0 h-full w-full cursor-default"
								onClick={() => setMobileMenuOpen(false)}
								aria-label="Close settings menu"
							/>
							<aside className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col overflow-hidden bg-white text-ink shadow-[0_24px_60px_rgba(0,0,0,0.2)]">
								<div className="border-b border-line px-4 py-4">
									<div className="flex items-center justify-between gap-3">
										<div>
											<p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-slate-500">Navigation</p>
											<h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Settings</h2>
										</div>
										<button
											type="button"
											className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.045] text-slate-500 transition-colors duration-150 hover:bg-black/[0.08] hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
											onClick={() => setMobileMenuOpen(false)}
											aria-label="Close settings menu"
										>
											<svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2">
												<path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										</button>
									</div>
								</div>
								<div className="flex flex-1 flex-col px-2 py-2">
									{visibleSectionItems.map((section) => (
										<button
											key={section.id}
											type="button"
											onClick={() => {
												setActiveSection(section.id);
												setMobileMenuOpen(false);
											}}
											className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[0.9375rem] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring cursor-pointer ${
												activeSection === section.id
													? "bg-black/[0.045] text-ink"
													: "text-muted hover:bg-black/[0.03] hover:text-ink"
											}`}
										>
											<span className={`mt-0.5 shrink-0 ${activeSection === section.id ? "text-ink" : "text-faint"}`}>
												<SectionIcon section={section.id} />
											</span>
											<span className={`leading-tight ${activeSection === section.id ? "text-ink" : "text-muted"}`}>
												{section.label}
											</span>
										</button>
									))}
									<ConnectionSidebarFooter
										target={target}
										clientConnected={connected}
										hostConnected={serverReady}
										onBackToChat={onBack}
									/>
								</div>
							</aside>
						</div>
					) : null}

					{/* ======== SIDEBAR ======== */}
					<nav className="hidden flex-col border-b border-line bg-[#fbfbfa] min-[961px]:sticky min-[961px]:top-0 min-[961px]:flex min-[961px]:min-h-svh min-[961px]:self-start min-[961px]:border-r min-[961px]:border-b-0">
						{/* Desktop: vertical sidebar */}
						<div className="text-ink min-[961px]:flex min-[961px]:min-h-svh min-[961px]:flex-col">
							<div className="border-b border-line px-5 py-4">
								<h2 className="text-[1rem] font-semibold tracking-tight text-slate-900">
									Settings
								</h2>
							</div>
							<div className="flex flex-1 flex-col px-2 py-2">
								{visibleSectionItems.map((section) => (
									<button
										key={section.id}
										type="button"
										onClick={() => setActiveSection(section.id)}
										className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[0.9375rem] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring cursor-pointer ${
											activeSection === section.id
												? "bg-black/[0.045] text-ink"
												: "text-muted hover:bg-black/[0.03] hover:text-ink"
										}`}
									>
										<span className={`mt-0.5 shrink-0 ${activeSection === section.id ? "text-ink" : "text-faint"}`}>
											<SectionIcon section={section.id} />
										</span>
										<span className={`leading-tight ${activeSection === section.id ? "text-ink" : "text-muted"}`}>
											{section.label}
										</span>
									</button>
								))}
								<ConnectionSidebarFooter
									target={target}
									clientConnected={connected}
									hostConnected={serverReady}
									onBackToChat={onBack}
								/>
							</div>
						</div>
					</nav>

					{/* ======== CONTENT ======== */}
					<div className="min-w-0 bg-white/72 px-3 py-3 backdrop-blur-[2px] min-[961px]:min-h-svh min-[961px]:px-6 min-[961px]:py-5">
						<header className="flex flex-col gap-2 border-b border-black/8 pb-3 min-[961px]:flex-row min-[961px]:items-start min-[961px]:justify-between min-[961px]:gap-4">
							<div>
								<h1 className="text-[1.28rem] font-bold tracking-tight leading-none text-slate-900 min-[961px]:text-[1.55rem]">
									{activeSectionTitle}
								</h1>
							</div>
							<div className="flex w-full shrink-0 flex-wrap items-center gap-2.5 min-[961px]:w-auto">
								{activeSection === "jobs" ? (
									<button
										type="button"
										className="inline-flex w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#171717] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer min-[961px]:w-auto"
										onClick={onRefreshJobs}
									>
										{refreshIcon(isLoadingJobs)}
										{isLoadingJobs ? "Syncing..." : "Sync Jobs"}
									</button>
								) : activeSection === "mcp" ? (
									<button
										type="button"
										className="inline-flex w-full items-center justify-center gap-2 border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#171717] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer min-[961px]:w-auto"
										onClick={onRefreshMcpServers}
										disabled={isLoadingMcpServers}
									>
										{refreshIcon(isLoadingMcpServers)}
										{isLoadingMcpServers ? "Syncing..." : "Sync MCP"}
									</button>
								) : null}
							</div>
						</header>

						<div className="mt-3 space-y-3 min-[961px]:mt-4 min-[961px]:space-y-4">
						<SettingsAccountSection
							active={activeSection === "account" || activeSection === "connection"}
							adminStatus={adminStatus}
							statusError={statusError}
							connectionError={connectionError}
							connected={connected}
							handleAppendSystemPromptSubmit={handleAppendSystemPromptSubmit}
							appendSystemPromptDraft={appendSystemPromptDraft}
							setAppendSystemPromptDraft={setAppendSystemPromptDraft}
							setAppendSystemPromptDirty={setAppendSystemPromptDirty}
							isSavingAppendPrompt={isSavingAppendPrompt}
							appendPromptSubmissionMessage={appendPromptSubmissionMessage}
							appendPromptSubmissionError={appendPromptSubmissionError}
						/>

						<SettingsModelsSection
							activeSection={activeSection}
							providers={providers}
							providersError={providersError}
							modelQuery={modelQuery}
							setModelQuery={setModelQuery}
							normalizedModelQuery={normalizedModelQuery}
							visibleModels={visibleModels}
							currentDefaultModel={currentDefaultModel}
							providerQuery={providerQuery}
							handleProviderQueryChange={handleProviderQueryChange}
							normalizedProviderQuery={normalizedProviderQuery}
							visibleProviders={visibleProviders}
							showAllProviders={showAllProviders}
							setShowAllProviders={setShowAllProviders}
							filteredProviders={filteredProviders}
							hiddenProviderCount={hiddenProviderCount}
							modelUpdateMessage={modelUpdateMessage}
							modelUpdateError={modelUpdateError}
							providerAuthError={providerAuthError}
							savingModelKey={savingModelKey}
							handleSelectModel={handleSelectModel}
							authActionProviderId={authActionProviderId}
							handleStartLogin={handleStartLogin}
							apiKeyEditorProviderId={apiKeyEditorProviderId}
							setApiKeyEditorProviderId={setApiKeyEditorProviderId}
							setProviderAuthError={setProviderAuthError}
							apiKeyDrafts={apiKeyDrafts}
							setApiKeyDrafts={setApiKeyDrafts}
							handleSaveApiKey={handleSaveApiKey}
						/>

						<SettingsInventorySections activeSection={activeSection} availableSkills={availableSkills} availableTools={availableTools} adminStatus={adminStatus} />

						<SettingsMcpSection
							activeSection={activeSection}
							mcpServers={mcpServers}
							mcpServersError={mcpServersError}
							isLoadingMcpServers={isLoadingMcpServers}
							onRefreshMcpServers={onRefreshMcpServers}
							enabledMcpServerCount={enabledMcpServerCount}
							readyMcpServerCount={readyMcpServerCount}
							mcpToolCount={mcpToolCount}
							mcpFormMessage={mcpFormMessage}
							mcpFormError={mcpFormError}
							handleSubmitMcpServer={handleSubmitMcpServer}
							mcpEditingServerId={mcpEditingServerId}
							resetMcpForm={resetMcpForm}
							setMcpFormError={setMcpFormError}
							setMcpFormMessage={setMcpFormMessage}
							mcpName={mcpName}
							setMcpName={setMcpName}
							mcpTransport={mcpTransport}
							setMcpTransport={setMcpTransport}
							mcpEnabled={mcpEnabled}
							setMcpEnabled={setMcpEnabled}
							mcpCommand={mcpCommand}
							setMcpCommand={setMcpCommand}
							mcpArgs={mcpArgs}
							setMcpArgs={setMcpArgs}
							mcpUrl={mcpUrl}
							setMcpUrl={setMcpUrl}
							mcpEnv={mcpEnv}
							setMcpEnv={setMcpEnv}
							mcpHeaders={mcpHeaders}
							setMcpHeaders={setMcpHeaders}
							mcpActionServerId={mcpActionServerId}
							handleEditMcpServer={handleEditMcpServer}
							handleToggleMcpServer={handleToggleMcpServer}
							handleDeleteSelectedMcpServer={handleDeleteSelectedMcpServer}
						/>


						{/* ---------- JOBS SECTION ---------- */}
						{activeSection === "jobs" && (
							<div className="space-y-3">
								<div className="border-t border-black/8 pt-3">
									<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Jobs</p>
									<h2 className="mt-1 text-[1rem] font-bold text-slate-950">Recurring job list</h2>
									<p className="mt-1 max-w-2xl text-[0.88rem] font-medium leading-[1.55] text-slate-500">
										Browse active recurring schedules here. Open any job to inspect its full configuration, run history, and transcript on the dedicated jobs page.
									</p>
								</div>
								<ScheduledJobList
									jobs={jobs}
									jobsError={jobsError}
									isLoadingJobs={isLoadingJobs}
									onSelectJob={onOpenJob}
								/>
							</div>
						)}
					</div>
						</div>
					</div>
				</div>
			</main>
		);
	}
