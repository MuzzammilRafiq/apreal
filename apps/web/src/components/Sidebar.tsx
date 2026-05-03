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
		<aside className="flex h-full min-h-0 flex-col border-b border-white/10 bg-sidebar-bg text-sidebar-ink min-[721px]:border-r min-[721px]:border-b-0">
			<div className="border-b border-white/10 px-6 pt-7 pb-6 max-[860px]:px-5">
				<button
					type="button"
					id="new-chat-button"
					className={[
						"mt-1 w-full border border-white/15 bg-sidebar-surface px-4 py-3.5 text-left text-[0.92rem] font-medium text-sidebar-ink transition duration-150 hover:border-white/25 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40",
						!activeSessionId && !pendingDraft ? "border-white/25 bg-white/8" : "",
					].join(" ")}
					onClick={onStartNewChat}
				>
					Start new chat
				</button>
				<button
					type="button"
					className="mt-3 w-full border border-white/10 bg-sidebar-panel px-4 py-3 text-left text-[0.84rem] font-medium text-sidebar-muted transition duration-150 hover:border-white/20 hover:bg-white/6 hover:text-sidebar-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
					onClick={onOpenSettings}
				>
					Open server settings
				</button>
			</div>
			<div className="max-[720px]:max-h-[34svh] flex-1 overflow-y-auto px-4.5 pt-4 pb-6">
				<div id="session-list" className="flex flex-col" aria-label="Chat sessions">
					{sessions.length === 0 ? (
						<p className="px-3 py-4 leading-[1.7] text-sidebar-muted">
							No saved sessions yet. Start a new chat and your first prompt will turn into a reusable thread here.
						</p>
					) : (
						sessions.map((session) => (
							<button
								key={session.id}
								type="button"
								className={getSessionCardClassName(session.id === activeSessionId)}
								aria-pressed={session.id === activeSessionId}
								onClick={() => onActivateSession(session.id)}
							>
								<div className="flex items-center justify-between gap-3">
									<p className="min-w-0 flex-1 text-[0.94rem] font-medium leading-[1.4] text-sidebar-ink">
										{session.title}
									</p>
									<span className="shrink-0 font-mono text-[0.72rem] text-sidebar-muted">
										{session.messageCount > 0
											? `${session.messageCount} msgs · ${session.busy ? "Running" : formatRelativeTime(session.updatedAt)}`
											: (session.busy ? "Running" : formatRelativeTime(session.updatedAt))}
									</span>
								</div>
								<p className="hidden">{session.model || "Model starts on first response"}</p>
							</button>
						))
					)}
					{canLoadMoreSessions ? (
						<button
							type="button"
							className="mt-4 border border-white/12 bg-sidebar-panel px-3 py-3 text-left text-[0.82rem] text-sidebar-muted transition duration-150 hover:border-white/20 hover:bg-white/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
							onClick={onLoadMoreSessions}
							disabled={loadingMoreSessions}
						>
							{loadingMoreSessions ? "Loading more sessions..." : "Load 50 more sessions"}
						</button>
					) : null}
				</div>
			</div>
			<div className="border-t border-white/10 bg-sidebar-panel px-6 pt-4.5 pb-5.5 max-[860px]:px-5">
				<p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em] text-sidebar-muted">
					State
				</p>
				<div className="mt-2 flex items-center gap-2 text-[0.82rem] text-sidebar-muted">
					<span className={`h-2.5 w-2.5 rounded-full ${serverReady ? "bg-[#56c271]" : "bg-[#d15a4f]"}`} />
					<span>{serverReady ? "Local server online" : "Waiting for local server"}</span>
				</div>
				<div className="mt-1.5 flex items-center gap-2 text-[0.82rem] text-sidebar-muted">
					<span className={`h-2.5 w-2.5 rounded-full ${relayReady ? "bg-[#56c271]" : "bg-[#d15a4f]"}`} />
					<span>{relayReady ? "Relay auth ready" : "Relay auth missing"}</span>
				</div>
				<div className="mt-1.5 flex items-center gap-2 text-[0.82rem] text-sidebar-muted">
					<span className={`h-2.5 w-2.5 rounded-full ${relayTransportConnected ? "bg-[#56c271]" : "bg-[#d6a248]"}`} />
					<span>{relayTransportConnected ? "Relay transport connected" : "Relay transport idle"}</span>
				</div>
				<p id="sidebar-status" className="mt-2 text-base font-medium">
					{serverReady ? (connected ? "Connected" : streamRequested ? "Disconnected - reconnecting..." : "Ready to connect") : "Waiting for local server"} · {sessionState}
				</p>
				<p className="mt-2 text-[0.8rem] leading-6 text-sidebar-muted">
					{totalSessions} stored {totalSessions === 1 ? "session" : "sessions"}
				</p>
			</div>
		</aside>
	);
});
