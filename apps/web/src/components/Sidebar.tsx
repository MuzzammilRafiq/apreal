import { memo, useEffect, useState } from "react";
import { Menu, MessageSquarePlus, Settings, Trash2, X } from "lucide-react";
import type { SessionSummary } from "../chatTypes";
import { formatRelativeTime, getSessionCardClassName } from "../chatView";
import { ConnectionSidebarFooter } from "./ConnectionSidebarFooter";

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
	onDeleteSession: (sessionId: string) => Promise<void>;
	onLoadMoreSessions: () => void;
	target: "local" | "remote";
	clientConnected: boolean;
	hostConnected: boolean;
};

const sidebarNavItemClassName =
	"ui-nav-item flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[0.9375rem] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

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
	onDeleteSession,
	onLoadMoreSessions,
	target,
	clientConnected,
	hostConnected,
	onClose,
}: SidebarProps & { onClose?: () => void }) {
	return (
		<>
			<ConnectionSidebarFooter
				target={target}
				clientConnected={clientConnected}
				hostConnected={hostConnected}
				placement="top"
			/>
			<div className="shrink-0 px-2 pt-2 pb-1.5">
			{onClose ? (
				<div className="mb-0.5 flex justify-end px-1">
						<button
							type="button"
							className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
							onClick={onClose}
							aria-label="Close chat menu"
						>
							<X className="h-4.5 w-4.5" strokeWidth={2.2} aria-hidden="true" />
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
						<MessageSquarePlus className="h-5 w-5 shrink-0" strokeWidth={2.1} aria-hidden="true" />
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
							<Settings className="h-5 w-5 shrink-0" strokeWidth={2.1} aria-hidden="true" />
							<span className="truncate">Settings</span>
						</button>
					) : null}
				</nav>
			</div>

			<div className="sidebar-scrollable-container min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
				<div id="session-list" className="flex flex-col gap-px" aria-label="Chat sessions">
					{sessions.length === 0 ? (
						<div className="mx-1 w-full bg-white px-4 py-5 text-center">
							<p className="text-[0.9375rem] leading-[1.6] text-muted">
								No saved sessions yet. Start a new chat and your first prompt will turn into a thread here.
							</p>
						</div>
					) : (
						sessions.map((session) => {
							const isActive = session.id === activeSessionId;
							const needsSync = sessionIdsNeedingSync.has(session.id);

							return (
								<div
									key={session.id}
									className={getSessionCardClassName(isActive)}
								>
									<button
										type="button"
										className="min-w-0 flex-1 text-left"
										aria-pressed={isActive}
										onClick={() => {
											onActivateSession(session.id);
											onClose?.();
										}}
									>
										<p className="truncate text-[0.9375rem] font-medium leading-snug tracking-tight">
											{session.title}
										</p>
									</button>
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
									<div className="relative flex items-center justify-end shrink-0 min-w-14 h-7">
										<span
											className={[
												"text-[0.8125rem] tabular-nums transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0",
												isActive ? "text-faint" : "text-faint",
											].join(" ")}
										>
											{formatRelativeTime(session.updatedAt)}
										</span>
										<button
											type="button"
											className="ui-icon-button absolute right-0 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-0 transition-opacity duration-150 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring group-hover:opacity-100"
											aria-label={`Delete ${session.title}`}
											title="Delete chat"
											disabled={session.busy}
											onClick={(event) => {
												event.stopPropagation();
												if (!window.confirm(`Delete "${session.title}"?`)) {
													return;
												}
												void onDeleteSession(session.id).catch((error) => {
													window.alert(error instanceof Error ? error.message : "Failed to delete chat.");
												});
											}}
										>
											<Trash2 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
										</button>
									</div>
								</div>
							);
						})
					)}
					{canLoadMoreSessions ? (
						<button
							type="button"
							className="ui-nav-item mt-0.5 flex w-full items-center justify-center rounded-lg px-3 py-1.5 text-[0.875rem] font-medium text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
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
	sessionIdsNeedingSync,
	loadingMoreSessions,
	canLoadMoreSessions,
	activeSessionId,
	onStartNewChat,
	onOpenSettings,
	onActivateSession,
	onDeleteSession,
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
			<div className="z-30 flex items-center justify-between gap-3 border-b border-(--color-brand-line) bg-[rgba(255,255,255,0.88)] px-3 py-2 text-[#171717] backdrop-blur-md min-[721px]:hidden">
				<button
					type="button"
					className="ui-icon-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
					onClick={() => setMobileMenuOpen(true)}
					aria-label="Open chat menu"
				>
					<Menu className="h-4.5 w-4.5" strokeWidth={2.2} aria-hidden="true" />
				</button>
				<div className="min-w-0 flex-1">
					<p className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-slate-500">Chat</p>
					<p className="truncate text-[0.9rem] font-semibold tracking-tight text-slate-800">
						{sessions.find((session) => session.id === activeSessionId)?.title ?? "New conversation"}
					</p>
				</div>
				<button
					type="button"
					className={[
						"ui-button-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
						!activeSessionId && !pendingDraft ? "opacity-70" : "",
					].join(" ")}
					onClick={onStartNewChat}
					aria-label="Start new chat"
				>
					<MessageSquarePlus className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />
				</button>
			</div>

			{mobileMenuOpen ? (
				<div className="fixed inset-0 z-50 bg-black/25 min-[721px]:hidden" aria-hidden="true">
					<button
						type="button"
						className="absolute inset-0 h-full w-full cursor-default"
						onClick={() => setMobileMenuOpen(false)}
						aria-label="Close chat menu"
					/>
					<aside className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col overflow-hidden border-r border-(--color-brand-line) bg-sidebar-panel text-ink shadow-[0_24px_60px_var(--color-brand-shadow)]">
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
							onDeleteSession={onDeleteSession}
							onLoadMoreSessions={onLoadMoreSessions}
							target={target}
							clientConnected={clientConnected}
							hostConnected={hostConnected}
							onClose={() => setMobileMenuOpen(false)}
						/>
					</aside>
				</div>
			) : null}

			<aside className="hidden min-h-0 flex-col overflow-hidden border-r border-black/8 bg-white text-ink min-[721px]:flex min-[721px]:h-full">
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
					onDeleteSession={onDeleteSession}
					onLoadMoreSessions={onLoadMoreSessions}
					target={target}
					clientConnected={clientConnected}
					hostConnected={hostConnected}
				/>
			</aside>
		</>
	);
});
