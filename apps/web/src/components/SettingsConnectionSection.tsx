import type { ReactNode } from "react";

import { renderStatusPill } from "./settings-helpers";

type SettingsConnectionSectionProps = Record<string, any>;

function ConnectionMetricCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 border border-slate-200 bg-slate-50 px-3 py-2">
			<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">{label}</p>
			<p className="mt-1 text-[0.95rem] font-bold leading-tight text-slate-900 [overflow-wrap:anywhere]">{value}</p>
		</div>
	);
}

function ConnectionValueRow({
	label,
	value,
	className = "",
	valueClassName = "",
}: {
	label: string;
	value: ReactNode;
	className?: string;
	valueClassName?: string;
}) {
	return (
		<div className={`grid min-w-0 gap-x-3 gap-y-1 border-b border-slate-200 py-2 last:border-b-0 min-[700px]:grid-cols-[10rem_minmax(0,1fr)] ${className}`.trim()}>
			<dt className="min-w-0 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">{label}</dt>
			<dd className={`min-w-0 text-[0.9rem] leading-[1.45] text-slate-800 [overflow-wrap:anywhere] ${valueClassName}`.trim()}>{value}</dd>
		</div>
	);
}

export function SettingsConnectionSection({
	activeSection,
	adminStatus,
	statusError,
	connectionError,
	relayReady,
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
											<h2 className="mt-1 text-base font-bold text-slate-900">Runtime, account link, and gateway state</h2>
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

									<div className="mt-4 grid gap-2 min-[700px]:grid-cols-3">
										<ConnectionMetricCard
											label="Local Server"
											value={adminStatus ? `Online on :${adminStatus.port}` : "Offline"}
										/>
										<ConnectionMetricCard label="Relay Account" value={relayReady ? "Linked" : "Sign in to link"} />
										<ConnectionMetricCard
											label="Gateway Transport"
											value={adminStatus?.relayTransportConnected ? "Connected" : "Idle"}
										/>
									</div>

									<dl className="mt-4 border-y border-slate-200">
										<ConnectionValueRow
											label="Active Port"
											value={adminStatus?.port ?? "Unavailable"}
											valueClassName="font-mono font-semibold text-slate-900"
										/>
										<ConnectionValueRow
											label="Local Agent ID"
											value={adminStatus?.agentId ?? "Not registered"}
											valueClassName="font-mono font-semibold"
										/>
										<ConnectionValueRow
											label="Connected Clients"
											value={adminStatus?.clients ?? "Unavailable"}
											valueClassName="font-mono font-semibold text-slate-900"
										/>
										<ConnectionValueRow
											label="Stored Sessions"
											value={adminStatus?.sessions ?? "Unavailable"}
											valueClassName="font-mono font-semibold text-slate-900"
										/>
										<ConnectionValueRow
											label="Root Workspace CWD"
											value={adminStatus?.cwd ?? "Unavailable"}
											valueClassName="font-mono text-[0.84rem] font-medium text-slate-700"
										/>
										<ConnectionValueRow
											label="Web UI Build State"
											valueClassName="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.9rem] font-semibold"
											value={
												<>
													<span className={`h-2 w-2 rounded-full ${adminStatus?.webUiReady ? "bg-slate-900" : "bg-slate-400"}`} />
													{adminStatus?.webUiReady ? "Built assets available" : "Built assets missing"}
													{adminStatus?.webUiPath ? <span className="font-mono text-[0.78rem] font-normal text-[#64748b]">· {adminStatus.webUiPath}</span> : ""}
												</>
											}
										/>
										<ConnectionValueRow
											label="Relay Gateway URL"
											value={adminStatus?.relayUrl ?? "Unavailable"}
											valueClassName="font-mono text-[0.84rem] font-medium text-slate-700"
										/>
										{adminStatus?.relayStartupError ? (
											<div className="mt-2 border border-slate-300 bg-slate-100 px-3 py-2.5">
												<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-700">Gateway startup error</p>
												<p className="mt-2 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">{adminStatus.relayStartupError}</p>
											</div>
										) : null}
									</dl>
								</div>

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
