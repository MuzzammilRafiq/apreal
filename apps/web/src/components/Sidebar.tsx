import { memo } from "react";
import type { SessionSummary } from "../chatTypes";
import { formatRelativeTime, getSessionCardClassName } from "../chatView";

type SidebarProps = {
	pendingDraft: boolean;
	sessions: SessionSummary[];
	loadingMoreSessions: boolean;
	canLoadMoreSessions: boolean;
	activeSessionId: string | null;
	onStartNewChat: () => void;
	onOpenSettings: () => void;
	onActivateSession: (sessionId: string) => void;
	onLoadMoreSessions: () => void;
};

export const Sidebar = memo(function Sidebar({
	pendingDraft,
	sessions,
	loadingMoreSessions,
	canLoadMoreSessions,
	activeSessionId,
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
							const messageLabel = `${session.messageCount} message${session.messageCount === 1 ? "" : "s"}`;

							return (
								<button
									key={session.id}
									type="button"
									className={getSessionCardClassName(session.id === activeSessionId)}
									aria-pressed={session.id === activeSessionId}
									onClick={() => onActivateSession(session.id)}
								>
									<div className="flex items-start justify-between gap-2.5">
										<p className="min-w-0 flex-1 truncate text-[0.84rem] font-medium leading-[1.35] tracking-tight">
											{session.title}
										</p>
									</div>
									<div className="mt-2 flex items-center justify-between gap-3 px-0.5 text-[0.7rem] font-medium text-[#9ca3af]">
										<span>{messageLabel}</span>
										<span className="shrink-0 font-mono text-[0.66rem] uppercase tracking-[0.08em] text-[#8c8c8c]">
											{formatRelativeTime(session.updatedAt)}
										</span>
									</div>
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
		</aside>
	);
});
