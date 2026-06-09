import { DEFAULT_VISIBLE_PROVIDER_COUNT, MCP_TRANSPORT_OPTIONS, formatProviderId, getMcpRuntimeLabel, getMcpRuntimeTone, renderStatusPill } from "./settings-helpers";

type SettingsModelsSectionProps = Record<string, any>;

export function SettingsModelsSection({
	activeSection,
	providers,
	providersError,
	modelQuery,
	setModelQuery,
	normalizedModelQuery,
	visibleModels,
	currentDefaultModel,
	providerQuery,
	handleProviderQueryChange,
	normalizedProviderQuery,
	visibleProviders,
	showAllProviders,
	setShowAllProviders,
	filteredProviders,
	hiddenProviderCount,
	modelUpdateMessage,
	modelUpdateError,
	providerAuthError,
	savingModelKey,
	handleSelectModel,
	authActionProviderId,
	handleStartLogin,
	apiKeyEditorProviderId,
	setApiKeyEditorProviderId,
	setProviderAuthError,
	apiKeyDrafts,
	setApiKeyDrafts,
	handleSaveApiKey,
}: SettingsModelsSectionProps) {
	return (
		<>
						{/* ---------- MODELS SECTION ---------- */}
						{activeSection === "models" && (
							<div className="space-y-3">
								<div className="border-t border-black/8 pt-3">
									<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Agent Provisioning</p>
									<h2 className="mt-1 text-[1rem] font-bold text-slate-900">Set default intelligence model</h2>

									{providersError ? (
										<p className="mt-3 border-l-2 border-black/25 bg-black/[0.03] px-3 py-2.5 text-[0.82rem] leading-[1.5] text-slate-800 font-medium">
											{providersError}
										</p>
									) : null}

									{providers && providers.providers.length === 0 ? (
										<p className="mt-3 border border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-500 text-center">
											No active providers configured yet.
										</p>
									) : null}

									{providers && providers.providers.length > 0 ? (
										<div className="mt-3 space-y-4">
											<div className="grid gap-3 border-b border-black/8 pb-3 min-[1180px]:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
												<div>
													<label className="block">
														<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">
															Deep search models
														</span>
														<div className="relative mt-1.5">
															<input
																type="search"
																value={modelQuery}
																onChange={(event) => setModelQuery(event.target.value)}
																placeholder="Type model id, name, or cloud provider..."
																className="w-full border-b border-slate-300 bg-transparent pl-8 pr-2 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500"
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

													<p className="mt-2 text-[0.75rem] leading-[1.4] text-slate-500 font-medium">
														{normalizedModelQuery ? `Showing ${visibleModels.length} result${visibleModels.length === 1 ? "" : "s"}.` : currentDefaultModel ? "Default selected." : "Search models."}
													</p>
												</div>

												<div>
													<label className="block">
														<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">
															Search providers
														</span>
														<div className="relative mt-1.5">
															<input
																type="search"
																value={providerQuery}
																onChange={(event) => handleProviderQueryChange(event.target.value)}
																placeholder="Type provider name, id, subscription, or api key..."
																className="w-full border-b border-slate-300 bg-transparent pl-8 pr-2 py-2.5 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500"
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

													<div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.75rem] leading-[1.4] text-slate-500 font-medium">
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
																className="border border-slate-200 bg-white px-2.5 py-1 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
																onClick={() => setShowAllProviders((current: boolean) => !current)}
															>
																{showAllProviders ? "Show Fewer" : `Show ${hiddenProviderCount} More`}
															</button>
														) : null}
													</div>
												</div>
											</div>

											{modelUpdateMessage ? (
												<p className="border-l border-black/12 px-3 py-2.5 text-xs leading-[1.5] text-slate-700 font-medium">
													{modelUpdateMessage}
												</p>
											) : null}
											{modelUpdateError ? (
												<p className="border-l-2 border-black/25 bg-black/[0.03] px-3 py-2.5 text-xs leading-[1.5] text-slate-800 font-medium">
													{modelUpdateError}
												</p>
											) : null}
											{providerAuthError ? (
												<p className="border-l-2 border-black/25 bg-black/[0.03] px-3 py-2.5 text-xs leading-[1.5] text-slate-800 font-medium">
													{providerAuthError}
												</p>
											) : null}

											<div className="grid gap-4 min-[1280px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
												<section className="space-y-3">
													<div className="flex items-center justify-between gap-3">
														<div>
															<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-400">Default model</p>
															<h3 className="mt-1 text-[1rem] font-bold text-slate-900">Choose what new chats start with</h3>
														</div>
														{currentDefaultModel ? renderStatusPill("Configured", "success") : renderStatusPill("Unselected", "neutral")}
													</div>

													{visibleModels.length > 0 ? (
														<ul className="overflow-hidden border-t border-black/8">
															{visibleModels.map((model: any, index: number) => {
																const isSaving = savingModelKey === model.key;
																return (
																	<li
																		key={model.key}
																		className={`grid gap-2 px-0 py-2.5 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-center ${
																			index > 0 ? "border-t border-black/8" : ""
																		}`}
																	>
																		<div className="min-w-0">
																			<p className="text-[0.9rem] font-bold text-slate-900">{model.label}</p>
																			<p className="mt-0.5 break-all text-[0.7rem] leading-tight font-mono text-slate-500 font-medium">
																				ID: {model.modelId} · {model.providerLabel} · <span className="text-slate-600 font-bold">{model.authType === "oauth" ? "Subscription" : "Custom Key"}</span>
																			</p>
																		</div>
																		<button
																			type="button"
																			className={`min-w-24 border px-3 py-1.5 text-[0.72rem] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 min-[560px]:justify-self-end cursor-pointer ${
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

													<ul className="space-y-2">
											{visibleProviders.map((provider: any) => {
												const isDefaultProvider = provider.id === providers.defaultProvider && provider.models.some((m: any) =>
													m.id === providers.defaultModel
												);
												return (
													<li
														key={provider.id}
													className={`border px-3 py-3 ${
														isDefaultProvider ? "border-slate-300 bg-white" : "border-slate-200 bg-white/70"
													}`}
													>
														<div className="flex flex-wrap items-start justify-between gap-2">
															<div className="min-w-0">
																<p className="text-[0.92rem] font-bold text-slate-900">{formatProviderId(provider.id)}</p>
																<p className="mt-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-400">
																	ID: {provider.id}
																</p>
															</div>
														<div className="flex flex-wrap items-center gap-2">
																{isDefaultProvider ? (
															<span className="inline-flex border border-slate-900 bg-slate-900 px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-white">
																		Default provider
																	</span>
																) : null}
															<span className="inline-flex border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
																	{provider.authType === "oauth" ? "Subscription" : "API key"}
																</span>
																{provider.supportsOAuth ? (
																	<span className="inline-flex border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
																		Pi login
																	</span>
																) : null}
																{provider.supportsApiKey ? (
																	<span className="inline-flex border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
																		API key
																	</span>
																) : null}
															</div>
														</div>
														<p className="mt-2 text-[0.76rem] text-slate-400 font-semibold">
															{provider.models.length > 0
																? `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} indexed.`
																: "No available models listed. Check your Apreal login status."}
														</p>
														{provider.supportsOAuth || provider.supportsApiKey ? (
															<div className="mt-2 flex flex-wrap items-center gap-2">
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
																			className="border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
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
																			className="border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
																			onClick={() => {
																				setApiKeyEditorProviderId((current: string | null) => current === provider.id ? null : provider.id);
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
															<div className="mt-2 border-t border-black/8 pt-2.5">
																<label className="block">
																	<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">
																		Stored API key
																	</span>
																	<input
																		type="password"
																		value={apiKeyDrafts[provider.id] ?? ""}
																		onChange={(event) => {
																			const nextValue = event.target.value;
																			setApiKeyDrafts((previous: Record<string, string>) => ({ ...previous, [provider.id]: nextValue }));
																		}}
																		placeholder="Paste API key"
																		className="mt-1.5 w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500"
																		autoComplete="off"
																		spellCheck={false}
																	/>
																</label>
																<div className="mt-2.5 flex flex-wrap items-center gap-2">
																	<button
																		type="button"
																		className="border border-black bg-black px-3 py-1.5 text-[0.72rem] font-bold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
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
		</>
	);
}
