import { getSkillToneClassName, getToolKindLabel, getToolToneClassName, StatusPill } from "./settings-helpers";

type SettingsInventorySectionsProps = Record<string, any>;

export function SettingsInventorySections({ activeSection, availableSkills, availableTools, adminStatus }: SettingsInventorySectionsProps) {
	return (
		<>
						{activeSection === "skills" && (
							<div className="space-y-3">
								<div className="border-t border-black/8 pt-3">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Pi SDK skills</p>
											<h2 className="mt-1 text-[1rem] font-bold text-slate-900">Current skill inventory</h2>
										</div>
										<StatusPill label={`${availableSkills.length} loaded`} tone={availableSkills.length > 0 ? "success" : "neutral"} />
									</div>

									<p className="mt-2 text-[0.84rem] leading-[1.55] text-slate-600">
										These are the currently discoverable Pi skills for this Apreal workspace and agent environment.
									</p>

									{availableSkills.length === 0 ? (
										<p className="mt-4 border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">
											No skills are currently available.
										</p>
									) : (
										<div className="mt-3 grid gap-2 min-[980px]:grid-cols-2">
											{availableSkills.map((skill: any) => (
												<article key={`${skill.name}:${skill.location}`} className="border border-slate-200 bg-white/70 px-3 py-3">
													<div className="flex items-start justify-between gap-3">
														<div className="min-w-0">
															<h3 className="text-[0.92rem] font-bold text-slate-900">{skill.name}</h3>
															<p className="mt-1.5 text-[0.79rem] leading-[1.45] text-slate-600">
																{skill.description}
															</p>
														</div>
														<span className={`shrink-0 border px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-[0.1em] ${getSkillToneClassName(skill.source)}`}>
															{skill.sourceLabel}
														</span>
													</div>
													<div className="mt-3 border-t border-slate-200 pt-2.5">
														<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Source path</p>
														<p className="mt-1 break-all text-[0.73rem] leading-[1.45] text-slate-700 font-mono">
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
						{activeSection === "tools" && (
							<div className="space-y-3">
								<div className="border-t border-black/8 pt-3">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Pi SDK tools</p>
											<h2 className="mt-1 text-[1rem] font-bold text-slate-900">Current tool inventory</h2>
										</div>
										<StatusPill label={`${availableTools.length} enabled`} tone={availableTools.length > 0 ? "success" : "neutral"} />
									</div>

									<div className="mt-3 grid gap-2 min-[720px]:grid-cols-3">
										<div className="border-t border-black/8 px-0 py-2.5">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Default tools</p>
											<p className="mt-1 text-base font-bold text-slate-900">
												{availableTools.filter((tool: any) => tool.kind === "built_in").length}
											</p>
										</div>
										<div className="border-t border-black/8 px-0 py-2.5">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Custom tools</p>
											<p className="mt-1 text-base font-bold text-slate-900">
												{availableTools.filter((tool: any) => tool.kind === "custom").length}
											</p>
										</div>
										<div className="border-t border-black/8 px-0 py-2.5">
											<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Workspace state</p>
											<p className="mt-1 text-base font-bold text-slate-900">
												{adminStatus ? "Live inventory" : "Unavailable"}
											</p>
										</div>
									</div>

									{availableTools.length === 0 ? (
										<p className="mt-4 border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">
											No tools are currently enabled.
										</p>
									) : (
										<div className="mt-3 overflow-hidden border-t border-black/8">
											{availableTools.map((tool: any, index: number) => (
												<div
													key={tool.name}
													className={`grid gap-2 px-0 py-3 min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[760px]:items-start ${
														index > 0 ? "border-t border-black/8" : ""
													}`}
												>
													<div className="min-w-0">
														<p className="text-[0.94rem] font-bold text-slate-900">{tool.label}</p>
														<p className="mt-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-400">
															Tool name: {tool.name}
														</p>
														<p className="mt-1.5 text-[0.8rem] leading-[1.45] text-slate-600">
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
		</>
	);
}
