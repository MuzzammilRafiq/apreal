import { memo, useEffect, useState } from "react";
import type { SessionSummary } from "../chatTypes";
import { formatRelativeTime, getSessionCardClassName } from "../chatView";
import { AccountAuthButton } from "./AccountAuthButton";

type SidebarProps = {
	pendingDraft: boolean;
	sessions: SessionSummary[];
	loadingMoreSessions: boolean;
	canLoadMoreSessions: boolean;
	activeSessionId: string | null;
	onStartNewChat: () => void;
	onOpenSettings: (() => void) | null;
	onActivateSession: (sessionId: string) => void;
	onLoadMoreSessions: () => void;
};

function SidebarContent({
	pendingDraft,
	sessions,
	loadingMoreSessions,
	canLoadMoreSessions,
	activeSessionId,
	onStartNewChat,
	onOpenSettings,
	onActivateSession,
	onLoadMoreSessions,
	onClose,
}: SidebarProps & { onClose?: () => void }) {
	return (
		<>
			<div className="border-b border-white/6 px-4 py-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-[#8c8c8c]">Workspace</p>
						<h2 className="mt-1 text-lg font-semibold tracking-tight text-white">Chats</h2>
					</div>
					{onClose ? (
						<button
							type="button"
							className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/4 text-[#b5b5b5] transition-colors duration-150 hover:border-white/16 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
							onClick={onClose}
							aria-label="Close chat menu"
						>
							<svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2">
								<path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</button>
					) : null}
				</div>

				<button
					type="button"
					id="new-chat-button"
					className={[
						"mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-white/12 bg-white px-3.5 py-2.5 text-center text-[0.88rem] font-semibold text-black transition-colors duration-150 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40",
						!activeSessionId && !pendingDraft ? "border-white" : "",
					].join(" ")}
					onClick={() => {
						onStartNewChat();
						onClose?.();
					}}
				>
					<svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
						<path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
					<span className="truncate">Start new chat</span>
				</button>
				{onOpenSettings ? (
					<button
						type="button"
						className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/4 px-3.5 py-2.5 text-center text-[0.8rem] font-semibold text-[#b5b5b5] transition-colors duration-150 hover:border-white/16 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
						onClick={() => {
							onOpenSettings();
							onClose?.();
						}}
					>
						<svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
							<path d="M3.333 10h13.334M3.333 5h13.334M3.333 15h13.334" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						<span className="truncate">Dashboard & Settings</span>
					</button>
				) : null}
				<div className="mt-2.5">
					<AccountAuthButton onAfterAction={onClose} />
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
				<div className="mb-2 flex items-center justify-between px-0.5">
					<h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#9ca3af]">Chats</h2>
					<span className="text-[0.68rem] font-medium text-[#7e7e7e]">{sessions.length}</span>
				</div>
				<div id="session-list" className="flex flex-col gap-1" aria-label="Chat sessions">
					{sessions.length === 0 ? (
						<div className="w-full rounded-md bg-white/2 px-3 py-4 text-center">
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
									onClick={() => {
										onActivateSession(session.id);
										onClose?.();
									}}
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
		</>
	);
}

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
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

	return (
		<>
			<div className="z-30 flex items-center justify-between gap-3 border-b border-black/8 bg-white px-3 py-3 text-[#171717] min-[721px]:hidden">
				<button
					type="button"
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-900 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
					onClick={() => setMobileMenuOpen(true)}
					aria-label="Open chat menu"
				>
					<svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2">
						<path d="M3.333 5h13.334M3.333 10h13.334M3.333 15h13.334" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
				<div className="min-w-0 flex-1">
					<p className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-500">Chat</p>
					<p className="truncate text-[0.9rem] font-semibold tracking-tight text-slate-900">
						{sessions.find((session) => session.id === activeSessionId)?.title ?? "New conversation"}
					</p>
				</div>
				<button
					type="button"
					className={[
						"flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-black bg-black text-white transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
						!activeSessionId && !pendingDraft ? "opacity-70" : "",
					].join(" ")}
					onClick={onStartNewChat}
					aria-label="Start new chat"
				>
					<svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
						<path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>

			{mobileMenuOpen ? (
				<div className="fixed inset-0 z-50 bg-black/40 min-[721px]:hidden" aria-hidden="true">
					<button
						type="button"
						className="absolute inset-0 h-full w-full cursor-default"
						onClick={() => setMobileMenuOpen(false)}
						aria-label="Close chat menu"
					/>
					<aside className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col overflow-hidden bg-[#111111] text-[#f3f4f6] shadow-2xl">
						<SidebarContent
							pendingDraft={pendingDraft}
							sessions={sessions}
							loadingMoreSessions={loadingMoreSessions}
							canLoadMoreSessions={canLoadMoreSessions}
							activeSessionId={activeSessionId}
							onStartNewChat={onStartNewChat}
							onOpenSettings={onOpenSettings}
							onActivateSession={onActivateSession}
							onLoadMoreSessions={onLoadMoreSessions}
							onClose={() => setMobileMenuOpen(false)}
						/>
					</aside>
				</div>
			) : null}

			<aside className="hidden min-h-0 flex-col overflow-hidden border-r border-white/6 bg-[#111111] text-[#f3f4f6] min-[721px]:flex min-[721px]:h-full">
				<SidebarContent
					pendingDraft={pendingDraft}
					sessions={sessions}
					loadingMoreSessions={loadingMoreSessions}
					canLoadMoreSessions={canLoadMoreSessions}
					activeSessionId={activeSessionId}
					onStartNewChat={onStartNewChat}
					onOpenSettings={onOpenSettings}
					onActivateSession={onActivateSession}
					onLoadMoreSessions={onLoadMoreSessions}
				/>
			</aside>
		</>
	);
});
