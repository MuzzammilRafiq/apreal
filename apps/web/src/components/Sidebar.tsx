import { memo } from "react";
import type { SessionSummary } from "../chatTypes";
import { formatRelativeTime, getSessionCardClassName } from "../chatView";

type SidebarProps = {
	connected: boolean;
	serverReady: boolean;
	relayReady: boolean;
	relayTransportConnected: boolean;
	streamRequested: boolean;
	pendingDraft: boolean;
	sessions: SessionSummary[];
	totalSessions: number;
	loadingMoreSessions: boolean;
	canLoadMoreSessions: boolean;
	activeSessionId: string | null;
	sessionState: string;
	onStartNewChat: () => void;
	onOpenSettings: () => void;
	onActivateSession: (sessionId: string) => void;
	onLoadMoreSessions: () => void;
};

export const Sidebar = memo(function Sidebar({
	connected,
	serverReady,
	relayReady,
	relayTransportConnected,
	streamRequested,
	pendingDraft,
	sessions,
	totalSessions,
	loadingMoreSessions,
	canLoadMoreSessions,
	activeSessionId,
	sessionState,
	onStartNewChat,
	onOpenSettings,
	onActivateSession,
	onLoadMoreSessions,
}: SidebarProps) {
	return (
		<aside className="z-30 flex h-full min-h-0 flex-col border-b border-white/6 bg-[#111111] text-[#f3f4f6] min-[721px]:border-r min-[721px]:border-b-0">
			{/* Header Actions */}
			<div className="border-b border-white/6 px-4 py-4.5">
				<button
					type="button"
					id="new-chat-button"
					className={[
						"flex w-full items-center justify-center gap-2 rounded-md border border-white/12 bg-white px-3.5 py-2.5 text-center text-[0.88rem] font-semibold text-black transition-colors duration-150 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40",
						!activeSessionId && !pendingDraft ? "border-white" : "",
					].join(" ")}
					onClick={onStartNewChat}
				>
					<svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
						<path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
					Start new chat
				</button>
				<button
					type="button"
					className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/4 px-3.5 py-2.5 text-center text-[0.8rem] font-semibold text-[#b5b5b5] transition-colors duration-150 hover:border-white/16 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
					onClick={onOpenSettings}
				>
					<svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
						<path d="M3.333 10h13.334M3.333 5h13.334M3.333 15h13.334" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
					Dashboard & Settings
				</button>
			</div>

			{/* Session List */}
			<div className="max-[720px]:max-h-[34svh] flex-1 overflow-y-auto px-2.5 pt-3 pb-4 scrollbar-thin">
				<div id="session-list" className="flex flex-col gap-1" aria-label="Chat sessions">
					{sessions.length === 0 ? (
						<div className="rounded-md bg-white/2 px-3 py-4 text-center">
							<p className="text-[0.84rem] leading-[1.6] text-[#9ca3af]">
								No saved sessions yet. Start a new chat and your first prompt will turn into a thread here.
							</p>
						</div>
					) : (
						sessions.map((session) => {
							const isScheduledSession = session.title.startsWith("[Scheduled:");

							return (
								<button
									key={session.id}
									type="button"
									className={getSessionCardClassName(session.id === activeSessionId)}
									aria-pressed={session.id === activeSessionId}
									onClick={() => onActivateSession(session.id)}
								>
									<div className="flex items-start justify-between gap-2.5">
										<div className="flex min-w-0 flex-1 items-start gap-2">
											{isScheduledSession ? (
												<span
												className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/6 text-white"
													aria-label="Scheduled session"
												>
													<svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.2">
														<circle cx="10" cy="10" r="6" />
														<path d="M10 6.5v4l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
													</svg>
												</span>
											) : (
												<span
													className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border text-xs ${
														session.id === activeSessionId
															? "border-white/20 bg-white/12 text-white"
															: "border-white/10 bg-white/4 text-[#9ca3af]"
													}`}
												>
													<svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
														<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
													</svg>
												</span>
											)}
											<p className="min-w-0 flex-1 truncate text-[0.84rem] font-medium leading-[1.35] tracking-tight">
												{session.title}
											</p>
										</div>
									</div>
									<div className="mt-2 flex items-center justify-between gap-2.5 px-0.5">
										<span className="truncate text-[0.7rem] font-medium text-[#9ca3af]">
											{session.model || "Awaiting model response"}
										</span>
										<span className="shrink-0 rounded-sm bg-white/5 px-1.5 py-0.5 font-mono text-[0.66rem] text-[#9ca3af]">
											{session.messageCount > 0
												? `${session.messageCount} msg${session.messageCount === 1 ? "" : "s"} · ${session.busy ? "Running" : formatRelativeTime(session.updatedAt)}`
												: (session.busy ? "Running" : formatRelativeTime(session.updatedAt))}
										</span>
									</div>
									<p className="hidden">{session.model || "Model starts on first response"}</p>
								</button>
							);
						})
					)}
					{canLoadMoreSessions ? (
						<button
							type="button"
						className="mt-2.5 rounded-md border border-white/10 bg-white/3 px-3 py-2.5 text-center text-[0.78rem] font-semibold text-[#9ca3af] transition duration-150 hover:border-white/14 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={onLoadMoreSessions}
							disabled={loadingMoreSessions}
						>
							{loadingMoreSessions ? "Loading sessions..." : "Load 50 more sessions"}
						</button>
					) : null}
				</div>
			</div>

			{/* Sidebar Footer with system statuses */}
			<div className="border-t border-white/6 bg-[#0d0d0d] px-4 py-4">
				<p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">
					System Status
				</p>
				<div className="mt-3 space-y-2">
					<div className="flex items-center gap-2 text-[0.76rem] text-[#9ca3af]">
						<span className="relative flex h-2 w-2 shrink-0">
							<span className={`relative inline-flex h-2 w-2 rounded-full ${serverReady ? "bg-white" : "bg-neutral-500"}`} />
						</span>
						<span className="font-medium">{serverReady ? "Local server online" : "Waiting for local server"}</span>
					</div>
					<div className="flex items-center gap-2 text-[0.76rem] text-[#9ca3af]">
						<span className="relative flex h-2 w-2 shrink-0">
							<span className={`relative inline-flex h-2 w-2 rounded-full ${relayReady ? "bg-white" : "bg-neutral-500"}`} />
						</span>
						<span className="font-medium">{relayReady ? "Relay auth ready" : "Relay auth missing"}</span>
					</div>
					<div className="flex items-center gap-2 text-[0.76rem] text-[#9ca3af]">
						<span className="relative flex h-2 w-2 shrink-0">
							<span className={`relative inline-flex h-2 w-2 rounded-full ${relayTransportConnected ? "bg-white" : "bg-neutral-500"}`} />
						</span>
						<span className="font-medium">{relayTransportConnected ? "Relay transport connected" : "Relay transport idle"}</span>
					</div>
				</div>

				<div className="mt-3.5 border-t border-white/6 pt-3">
					<p id="sidebar-status" className="flex items-center justify-between text-[0.78rem] font-semibold text-white">
						<span>{serverReady ? (connected ? "Connected" : streamRequested ? "Reconnecting..." : "Ready") : "Waiting"}</span>
						<span className="rounded-sm bg-white/5 px-1.5 py-0.5 font-mono text-[0.68rem] text-[#9ca3af]">{sessionState}</span>
					</p>
					<p className="mt-1.5 text-[0.72rem] text-[#9ca3af]">
						{totalSessions} stored thread{totalSessions === 1 ? "" : "s"}
					</p>
				</div>
			</div>
		</aside>
	);
});
