import type { McpServerTransport } from "@apreal/shared";
import { DEFAULT_VISIBLE_PROVIDER_COUNT, MCP_TRANSPORT_OPTIONS, formatProviderId, getMcpRuntimeLabel, getMcpRuntimeTone, renderStatusPill } from "./settings-helpers";

type SettingsMcpSectionProps = Record<string, any>;

export function SettingsMcpSection({
	activeSection,
	mcpServers,
	mcpServersError,
	isLoadingMcpServers,
	onRefreshMcpServers,
	enabledMcpServerCount,
	readyMcpServerCount,
	mcpToolCount,
	mcpFormMessage,
	mcpFormError,
	handleSubmitMcpServer,
	mcpEditingServerId,
	resetMcpForm,
	setMcpFormError,
	setMcpFormMessage,
	mcpName,
	setMcpName,
	mcpTransport,
	setMcpTransport,
	mcpEnabled,
	setMcpEnabled,
	mcpCommand,
	setMcpCommand,
	mcpArgs,
	setMcpArgs,
	mcpUrl,
	setMcpUrl,
	mcpEnv,
	setMcpEnv,
	mcpHeaders,
	setMcpHeaders,
	mcpActionServerId,
	handleEditMcpServer,
	handleToggleMcpServer,
	handleDeleteSelectedMcpServer,
}: SettingsMcpSectionProps) {
	return (
		<>
						{activeSection === "mcp" && (
							<div className="space-y-3">
								<div className="border-t border-black/8 pt-3">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Model Context Protocol</p>
											<h2 className="mt-1 text-[1rem] font-bold text-slate-900">Manage MCP server definitions</h2>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<button
												type="button"
												className="border border-slate-300 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
												onClick={onRefreshMcpServers}
												disabled={isLoadingMcpServers}
											>
												{isLoadingMcpServers ? "Syncing..." : "Sync MCP"}
											</button>
											{renderStatusPill(`${enabledMcpServerCount}/${mcpServers.length} active`, enabledMcpServerCount > 0 ? "success" : "neutral")}
										</div>
									</div>

									<p className="mt-2 text-[0.84rem] leading-[1.55] text-slate-600">
										Configured MCP servers are discovered by the local Apreal server and their tools become available to new chats automatically.
									</p>

									<div className="mt-3 grid gap-2 min-[720px]:grid-cols-3">
										<div className="border-t border-black/8 py-2.5">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Configured servers</p>
											<p className="mt-1 text-base font-bold text-slate-900">{mcpServers.length}</p>
										</div>
										<div className="border-t border-black/8 py-2.5">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Healthy connections</p>
											<p className="mt-1 text-base font-bold text-slate-900">{readyMcpServerCount}</p>
										</div>
										<div className="border-t border-black/8 py-2.5">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Discovered tools</p>
											<p className="mt-1 text-base font-bold text-slate-900">{mcpToolCount}</p>
										</div>
									</div>

									<p className="mt-3 text-[0.78rem] text-slate-500 font-medium">
										{enabledMcpServerCount} enabled server{enabledMcpServerCount === 1 ? "" : "s"}. Runtime health updates when the local server refreshes MCP tool discovery.
									</p>

									{mcpServersError ? (
										<p className="mt-3 border-l-2 border-black/25 bg-black/[0.03] px-3 py-2.5 text-[0.82rem] leading-[1.5] text-slate-800 font-medium">
											{mcpServersError}
										</p>
									) : null}
									{mcpFormMessage ? (
										<p className="mt-3 border-l border-black/12 px-3 py-2.5 text-[0.82rem] leading-[1.5] text-slate-700 font-medium">
											{mcpFormMessage}
										</p>
									) : null}
									{mcpFormError ? (
										<p className="mt-3 border-l-2 border-black/25 bg-black/[0.03] px-3 py-2.5 text-[0.82rem] leading-[1.5] text-slate-800 font-medium">
											{mcpFormError}
										</p>
									) : null}

									<div className="mt-3 grid gap-4 min-[1180px]:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
										<form className="space-y-3 border-t border-black/8 pt-3" onSubmit={handleSubmitMcpServer}>
											<div className="flex items-center justify-between gap-3">
												<div>
													<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-400">Editor</p>
													<h3 className="mt-1 text-[1rem] font-bold text-slate-900">{mcpEditingServerId ? "Edit MCP server" : "Add MCP server"}</h3>
												</div>
												{mcpEditingServerId ? (
													<button type="button" className="border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer" onClick={() => {
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
												<input type="text" value={mcpName} onChange={(event) => setMcpName(event.target.value)} placeholder="filesystem" className="mt-1.5 w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" autoComplete="off" spellCheck={false} />
											</label>

											<div className="grid gap-4 min-[640px]:grid-cols-[minmax(0,1fr)_auto]">
												<label className="block">
													<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Transport</span>
													<select value={mcpTransport} onChange={(event) => setMcpTransport(event.target.value as McpServerTransport)} className="mt-1.5 w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm text-[#171717] outline-none transition focus:border-slate-500">
														{MCP_TRANSPORT_OPTIONS.map((option) => (
															<option key={option.value} value={option.value}>{option.label}</option>
														))}
													</select>
													<p className="mt-1.5 text-[0.74rem] leading-[1.45] text-slate-500">{MCP_TRANSPORT_OPTIONS.find((option) => option.value === mcpTransport)?.description}</p>
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
														<input type="text" value={mcpCommand} onChange={(event) => setMcpCommand(event.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem" className="mt-1.5 w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" autoComplete="off" spellCheck={false} />
													</label>
													<label className="block">
														<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Arguments</span>
														<textarea value={mcpArgs} onChange={(event) => setMcpArgs(event.target.value)} placeholder="One argument per line" className="mt-1.5 min-h-24 w-full border border-slate-300 bg-white/70 px-3 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" spellCheck={false} />
													</label>
												</>
											) : (
												<label className="block">
													<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Server URL</span>
													<input type="url" value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://example.com/mcp" className="mt-1.5 w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" autoComplete="off" spellCheck={false} />
												</label>
											)}

											<label className="block">
												<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Environment variables</span>
												<textarea value={mcpEnv} onChange={(event) => setMcpEnv(event.target.value)} placeholder="KEY=value" className="mt-1.5 min-h-24 w-full border border-slate-300 bg-white/70 px-3 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" spellCheck={false} />
											</label>

											{mcpTransport !== "stdio" ? (
												<label className="block">
													<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Request headers</span>
													<textarea value={mcpHeaders} onChange={(event) => setMcpHeaders(event.target.value)} placeholder="Authorization=Bearer ..." className="mt-1.5 min-h-24 w-full border border-slate-300 bg-white/70 px-3 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-slate-500" spellCheck={false} />
												</label>
											) : null}

											<button type="submit" className="w-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer" disabled={mcpActionServerId !== null}>
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
												<ul className="space-y-2">
													{mcpServers.map((server: any) => {
														const isBusy = mcpActionServerId === server.id;
														return (
															<li key={server.id} className={`border px-3 py-3 ${server.enabled ? "border-slate-300 bg-white" : "border-slate-200 bg-white/70"}`}>
																<div className="flex flex-wrap items-start justify-between gap-3">
																	<div className="min-w-0">
																		<div className="flex flex-wrap items-center gap-2">
																			<p className="text-[0.94rem] font-bold text-slate-900">{server.name}</p>
																			<span className={`border px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] ${server.enabled ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-500"}`}>{server.enabled ? "Enabled" : "Disabled"}</span>
																			<span className="border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-slate-500">{server.transport}</span>
																			{renderStatusPill(getMcpRuntimeLabel(server), getMcpRuntimeTone(server))}
																		</div>
																		<p className="mt-1.5 break-all font-mono text-[0.72rem] text-slate-500">
																			{server.transport === "stdio" ? `${server.command ?? "No command"}${server.args.length > 0 ? ` ${server.args.join(" ")}` : ""}` : server.url ?? "No URL"}
																		</p>
																	</div>
																	<div className="flex flex-wrap items-center gap-2">
																		<button type="button" className="border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer" onClick={() => handleEditMcpServer(server)} disabled={mcpActionServerId !== null}>Edit</button>
																		<button type="button" className="border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer" onClick={() => { void handleToggleMcpServer(server); }} disabled={mcpActionServerId !== null}>{isBusy ? "Saving..." : server.enabled ? "Disable" : "Enable"}</button>
																		<button type="button" className="border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-bold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer" onClick={() => { void handleDeleteSelectedMcpServer(server.id); }} disabled={mcpActionServerId !== null}>{isBusy ? "Deleting..." : "Delete"}</button>
																	</div>
																</div>
																<div className="mt-2.5 grid gap-2 text-[0.76rem] text-slate-600 min-[720px]:grid-cols-2">
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
		</>
	);
}
