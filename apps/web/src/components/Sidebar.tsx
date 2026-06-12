import { memo, useEffect, useState } from "react";
import type { SessionSummary } from "../chatTypes";
import { formatRelativeTime, getSessionCardClassName } from "../chatView";
import { ConnectionSidebarFooter } from "./ConnectionSidebarFooter";
import gearIcon from "./svgs/gear.svg";
import newChatIcon from "./svgs/new-chat.svg";

type SidebarProps = {
	pendingDraft: boolean;
	sessions: SessionSummary[];
	sessionIdsNeedingSync: Set<string>;
	loadingMoreSessions: boolean;
	canLoadMoreSessions: boolean;
	activeSessionId: string | null;
	onStartNewChat: () => void;
	onOpenSettings: (() => void) | null;
	onActivateSession: (sessionId: string) => void;
	onLoadMoreSessions: () => void;
	target: "local" | "remote";
	clientConnected: boolean;
	hostConnected: boolean;
};

const sidebarNavItemClassName =
	"flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[0.9375rem] font-medium text-ink transition-colors duration-150 hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function SidebarContent({
	pendingDraft,
	sessions,
	sessionIdsNeedingSync,
	loadingMoreSessions,
	canLoadMoreSessions,
	activeSessionId,
	onStartNewChat,
	onOpenSettings,
	onActivateSession,
	onLoadMoreSessions,
	target,
	clientConnected,
	hostConnected,
	onClose,
}: SidebarProps & { onClose?: () => void }) {
	return (
		<>
		<div className="shrink-0 px-2 pt-2 pb-1.5">
			{onClose ? (
				<div className="mb-0.5 flex justify-end px-1">
						<button
							type="button"
							className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onClose}
							aria-label="Close chat menu"
						>
							<svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</button>
					</div>
				) : null}

				<nav className="flex flex-col gap-px" aria-label="Sidebar actions">
					<button
						type="button"
						id="new-chat-button"
						className={sidebarNavItemClassName}
						onClick={() => {
							onStartNewChat();
							onClose?.();
						}}
					>
						<img src={newChatIcon} alt="" className="h-5 w-5 shrink-0" aria-hidden="true" />
						<span className="truncate">New chat</span>
					</button>
					{onOpenSettings ? (
						<button
							type="button"
							className={sidebarNavItemClassName}
							onClick={() => {
								onOpenSettings();
								onClose?.();
							}}
						>
							<img src={gearIcon} alt="" className="h-5 w-5 shrink-0" aria-hidden="true" />
							<span className="truncate">Settings</span>
						</button>
					) : null}
				</nav>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
				<div id="session-list" className="flex flex-col gap-px" aria-label="Chat sessions">
					{sessions.length === 0 ? (
						<div className="mx-1 w-full bg-black/[0.03] px-4 py-5 text-center">
							<p className="text-[0.9375rem] leading-[1.6] text-muted">
								No saved sessions yet. Start a new chat and your first prompt will turn into a thread here.
							</p>
						</div>
					) : (
						sessions.map((session) => {
							const isActive = session.id === activeSessionId;
							const needsSync = sessionIdsNeedingSync.has(session.id);

							return (
								<button
									key={session.id}
									type="button"
									className={getSessionCardClassName(isActive)}
									aria-pressed={isActive}
									onClick={() => {
										onActivateSession(session.id);
										onClose?.();
									}}
								>
									<p className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium leading-snug tracking-tight">
										{session.title}
									</p>
									{needsSync ? (
										<span
											className={[
												"flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-bold leading-none",
												isActive
													? "border-slate-400 text-slate-700"
													: "border-slate-300 text-slate-500 group-hover:border-slate-400 group-hover:text-slate-700",
											].join(" ")}
											title="Transcript updates when opened"
											aria-label="Transcript updates when opened"
										>
											!
										</span>
									) : null}
									<span
										className={[
											"shrink-0 text-[0.8125rem] tabular-nums transition-colors duration-150",
											isActive ? "text-faint" : "text-faint group-hover:text-muted",
										].join(" ")}
									>
										{formatRelativeTime(session.updatedAt)}
									</span>
								</button>
							);
						})
					)}
					{canLoadMoreSessions ? (
						<button
							type="button"
							className="mt-0.5 flex w-full items-center justify-center rounded-md px-3 py-2.5 text-[0.875rem] font-medium text-muted transition-colors duration-150 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
								onClick={onLoadMoreSessions}
							disabled={loadingMoreSessions}
						>
							{loadingMoreSessions ? "Loading sessions..." : "Load 50 more sessions"}
						</button>
					) : null}
				</div>
			</div>
			<ConnectionSidebarFooter
				target={target}
				clientConnected={clientConnected}
				hostConnected={hostConnected}
			/>
		</>
	);
}

export const Sidebar = memo(function Sidebar({
	pendingDraft,
	sessions,
	sessionIdsNeedingSync,
	loadingMoreSessions,
	canLoadMoreSessions,
	activeSessionId,
	onStartNewChat,
	onOpenSettings,
	onActivateSession,
	onLoadMoreSessions,
	target,
	clientConnected,
	hostConnected,
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
			<div className="z-30 flex items-center justify-between gap-3 border-b border-black/8 bg-white/88 px-3 py-3 text-[#171717] backdrop-blur-md min-[721px]:hidden">
				<button
					type="button"
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.045] text-slate-900 transition-colors duration-150 hover:bg-black/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
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
						"flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-white transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
						!activeSessionId && !pendingDraft ? "opacity-70" : "",
					].join(" ")}
					onClick={onStartNewChat}
					aria-label="Start new chat"
				>
					<img src={newChatIcon} alt="" className="h-4 w-4" aria-hidden="true" />
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
					<aside className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col overflow-hidden bg-white text-ink shadow-[0_24px_60px_rgba(0,0,0,0.2)]">
						<SidebarContent
							pendingDraft={pendingDraft}
							sessions={sessions}
							sessionIdsNeedingSync={sessionIdsNeedingSync}
							loadingMoreSessions={loadingMoreSessions}
							canLoadMoreSessions={canLoadMoreSessions}
							activeSessionId={activeSessionId}
							onStartNewChat={onStartNewChat}
							onOpenSettings={onOpenSettings}
							onActivateSession={onActivateSession}
							onLoadMoreSessions={onLoadMoreSessions}
							target={target}
							clientConnected={clientConnected}
							hostConnected={hostConnected}
							onClose={() => setMobileMenuOpen(false)}
						/>
					</aside>
				</div>
			) : null}

			<aside className="hidden min-h-0 flex-col overflow-hidden border-r border-black/8 bg-[#fbfbfa] text-ink min-[721px]:flex min-[721px]:h-full">
				<SidebarContent
					pendingDraft={pendingDraft}
					sessions={sessions}
					sessionIdsNeedingSync={sessionIdsNeedingSync}
					loadingMoreSessions={loadingMoreSessions}
					canLoadMoreSessions={canLoadMoreSessions}
					activeSessionId={activeSessionId}
					onStartNewChat={onStartNewChat}
					onOpenSettings={onOpenSettings}
					onActivateSession={onActivateSession}
					onLoadMoreSessions={onLoadMoreSessions}
					target={target}
					clientConnected={clientConnected}
					hostConnected={hostConnected}
				/>
			</aside>
		</>
	);
});
