import { renderStatusPill } from "./settings-helpers";

type SettingsConnectionSectionProps = Record<string, any>;

export function SettingsConnectionSection({
	activeSection,
	adminStatus,
	statusError,
	connectionError,
	relayReady,
	isOnline,
	pairingCode,
	setPairingCode,
	handleSubmit,
	isSubmitting,
	submissionMessage,
	submissionError,
	handleAppendSystemPromptSubmit,
	appendSystemPromptDraft,
	setAppendSystemPromptDraft,
	setAppendSystemPromptDirty,
	isSavingAppendPrompt,
	appendPromptSubmissionMessage,
	appendPromptSubmissionError,
}: SettingsConnectionSectionProps) {
	return (
		<>
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
												{adminStatus?.webUiReady ? "Built assets available" : "Built assets missing"}
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

								<form className="border border-black/8 bg-white p-5" onSubmit={handleAppendSystemPromptSubmit}>
									<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Prompt Layering</p>
									<h2 className="mt-1 text-base font-bold text-slate-900">Append instructions to Pi's system prompt</h2>
									<p className="mt-2 text-[0.88rem] leading-[1.6] text-slate-600">
										Saved to <span className="font-mono text-[0.8rem] text-slate-800">{adminStatus?.appendSystemPromptPath ?? "APPEND_SYSTEM.md"}</span>. Pi appends this after its base prompt for new or reloaded sessions.
									</p>

									<label className="mt-4 block">
										<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Additional system instructions</span>
										<textarea
											value={appendSystemPromptDraft}
											onChange={(event) => {
												setAppendSystemPromptDraft(event.target.value);
												setAppendSystemPromptDirty(true);
											}}
											rows={10}
											placeholder={"Example:\n- Always explain tradeoffs before editing infra code.\n- Prefer existing project patterns over introducing new abstractions."}
											className="mt-2 min-h-[14rem] w-full resize-y border border-slate-300 bg-[#f8f8f8] px-3 py-2.5 text-[0.95rem] leading-[1.6] text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500 focus:bg-white"
											spellCheck={false}
										/>
									</label>

									<div className="mt-4 flex flex-wrap items-center gap-3">
										<button
											type="submit"
											className="inline-flex items-center justify-center border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
											disabled={isSavingAppendPrompt || !adminStatus || appendSystemPromptDraft === (adminStatus.appendSystemPrompt ?? "")}
										>
											{isSavingAppendPrompt ? "Saving prompt..." : "Save appended prompt"}
										</button>
										<button
											type="button"
											className="inline-flex items-center justify-center border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
											disabled={isSavingAppendPrompt || !adminStatus || appendSystemPromptDraft.length === 0}
											onClick={() => {
												setAppendSystemPromptDraft("");
												setAppendSystemPromptDirty(true);
											}}
										>
											Clear editor
										</button>
									</div>

									{appendPromptSubmissionMessage ? (
										<p className="mt-3 border border-slate-300 bg-white p-3 text-[0.84rem] leading-[1.5] text-slate-700 font-medium">
											{appendPromptSubmissionMessage}
										</p>
									) : null}
									{appendPromptSubmissionError ? (
										<p className="mt-3 border border-slate-300 bg-slate-100 p-3 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">
											{appendPromptSubmissionError}
										</p>
									) : null}
								</form>
							</div>
						)}
		</>
	);
}
