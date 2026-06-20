import { memo, useEffect, useRef, useState, type TouchEvent } from "react";
import { ArrowLeft, CloudSync, Ellipsis, LoaderCircle, Menu, MessageCircle, Settings, Trash } from "lucide-react";
import type { SessionSummary } from "../chatTypes";
import { getSessionCardClassName } from "../chatView";
import { ConnectionSidebarFooter } from "./ConnectionSidebarFooter";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";

type SidebarProps = {
	pendingDraft: boolean;
	sessions: SessionSummary[];
	sessionIdsNeedingSync: Set<string>;
	loadingMoreSessions: boolean;
	canLoadMoreSessions: boolean;
	activeSessionId: string | null;
	onStartNewChat: () => void;
	onOpenSettings: (() => void) | null;
	onSyncAllChats: () => void;
	onActivateSession: (sessionId: string) => void;
	onDeleteSession: (sessionId: string) => Promise<void>;
	onLoadMoreSessions: () => void;
	target: "local" | "remote";
	clientConnected: boolean;
	clientConnecting?: boolean;
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
	onSyncAllChats,
	onActivateSession,
	onDeleteSession,
	onLoadMoreSessions,
	target,
	clientConnected,
	clientConnecting,
	hostConnected,
	onClose,
}: SidebarProps & { onClose?: () => void }) {
	const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
	const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
	const longPressTimer = useRef<number | null>(null);
	const longPressStart = useRef<{ x: number; y: number } | null>(null);
	const suppressSessionClick = useRef(false);

	const clearLongPress = () => {
		if (longPressTimer.current !== null) {
			window.clearTimeout(longPressTimer.current);
			longPressTimer.current = null;
		}
		longPressStart.current = null;
	};

	const startLongPress = (session: SessionSummary, event: TouchEvent<HTMLDivElement>) => {
		const touch = event.touches[0];
		if (!touch) {
			return;
		}
		clearLongPress();
		longPressStart.current = { x: touch.clientX, y: touch.clientY };
		longPressTimer.current = window.setTimeout(() => {
			suppressSessionClick.current = true;
			setSelectedSession(session);
			longPressTimer.current = null;
		}, 500);
	};

	const moveLongPress = (event: TouchEvent<HTMLDivElement>) => {
		const start = longPressStart.current;
		const touch = event.touches[0];
		if (!start || !touch) {
			return;
		}
		if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
			clearLongPress();
		}
	};

	useEffect(() => clearLongPress, []);

	const selectedSessionNeedsSync = selectedSession
		? sessionIdsNeedingSync.has(selectedSession.id)
		: false;
	const closeSessionActions = () => {
		suppressSessionClick.current = false;
		setSelectedSession(null);
	};

	return (
		<>
			{onClose ? (
				<button
					type="button"
					className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
					onClick={onClose}
					aria-label="Back to chat"
				>
					<ArrowLeft className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
				</button>
			) : null}
			<ConnectionSidebarFooter
				target={target}
				clientConnected={clientConnected}
				clientConnecting={clientConnecting}
				hostConnected={hostConnected}
				placement="top"
			/>
			<div className="shrink-0 px-2 pt-2 pb-1.5">
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
						<MessageCircle className="h-5 w-5 shrink-0" strokeWidth={2.1} aria-hidden="true" />
						<span className="truncate">New chat</span>
					</button>
					{onOpenSettings ? (
						<button
							type="button"
							className={sidebarNavItemClassName}
							onClick={() => {
								setSettingsDialogOpen(true);
							}}
						>
							<Settings className="h-5 w-5 shrink-0" strokeWidth={2.1} aria-hidden="true" />
							<span className="truncate">Settings</span>
						</button>
					) : null}
				</nav>
			</div>

			<div className="sidebar-scrollable-container min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				<div id="session-list" className="flex flex-col gap-px" aria-label="Chat sessions">
					{sessions.length === 0 ? (
						<div className="mx-1 w-full bg-white px-4 py-5 text-center">
							
						</div>
					) : (
						sessions.map((session) => {
							const isActive = session.id === activeSessionId;
							const needsSync = sessionIdsNeedingSync.has(session.id);

							return (
								<div
									key={session.id}
									className={getSessionCardClassName(isActive)}
									onTouchStart={(event) => startLongPress(session, event)}
									onTouchMove={moveLongPress}
									onTouchEnd={clearLongPress}
									onTouchCancel={clearLongPress}
									onContextMenu={(event) => {
										event.preventDefault();
										setSelectedSession(session);
									}}
								>
									<button
										type="button"
										className="min-w-0 flex-1 text-left"
										aria-pressed={isActive}
										onClick={() => {
											if (suppressSessionClick.current) {
												suppressSessionClick.current = false;
												return;
											}
											onActivateSession(session.id);
											onClose?.();
										}}
									>
										<p
											className={`truncate text-[0.9375rem] leading-snug tracking-tight ${needsSync ? "font-semibold text-ink" : "font-normal"}`}
										>
											{session.title}
										</p>
									</button>
									{session.busy ? (
										<span
											className="flex h-7 w-7 shrink-0 items-center justify-center text-slate-500"
											role="status"
											aria-label={`${session.title} is working`}
											title="Chat is working"
										>
											<LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
										</span>
									) : null}
									<div className="hidden h-7 w-7 shrink-0 items-center justify-center min-[721px]:flex">
										<button
											type="button"
											className="ui-icon-button flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-0 transition-[color,opacity] duration-150 hover:text-slate-700 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring group-hover:opacity-100 group-focus-within:opacity-100"
											aria-label={`More options for ${session.title}`}
											title="Chat options"
											onClick={(event) => {
												event.stopPropagation();
												suppressSessionClick.current = false;
												setSelectedSession(session);
											}}
										>
											<Ellipsis className="h-4.5 w-4.5" strokeWidth={2.1} aria-hidden="true" />
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

			<Dialog
				open={selectedSession !== null}
				onOpenChange={(open) => {
					if (!open) {
						closeSessionActions();
					}
				}}
			>
				<DialogContent aria-describedby={selectedSession ? "chat-actions-description" : undefined}>
					{selectedSession ? (
						<>
							<DialogHeader>
								<DialogTitle className="truncate">{selectedSession.title}</DialogTitle>
								<DialogDescription id="chat-actions-description">
									{selectedSessionNeedsSync ? "Updates are available for this chat." : "This chat is up to date."}
								</DialogDescription>
							</DialogHeader>

							<div className="overflow-hidden rounded-xl border border-black/8">
								<button
									type="button"
									className="flex w-full items-center gap-3 border-b border-black/8 px-3.5 py-3 text-left text-sm font-medium transition-colors hover:bg-black/4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring disabled:cursor-default disabled:text-slate-500 disabled:hover:bg-transparent"
									disabled={!selectedSessionNeedsSync}
									onClick={() => {
										if (!selectedSessionNeedsSync) {
											return;
										}
										onActivateSession(selectedSession.id);
										closeSessionActions();
										onClose?.();
									}}
								>
									<CloudSync className="h-4.5 w-4.5 text-slate-500" strokeWidth={1.9} aria-hidden="true" />
									<span>{selectedSessionNeedsSync ? "Sync" : "Up to date"}</span>
								</button>

								<div className="flex items-center justify-between gap-4 border-b border-black/8 px-3.5 py-3 text-sm">
									<span className="text-slate-500">Last updated</span>
									<time
										className="text-right font-medium tabular-nums text-slate-700"
										dateTime={new Date(selectedSession.updatedAt).toISOString()}
									>
										{new Date(selectedSession.updatedAt).toLocaleString([], {
											dateStyle: "medium",
											timeStyle: "short",
										})}
									</time>
								</div>

								<button
									type="button"
									className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50"
									disabled={selectedSession.busy}
									onClick={() => {
										const session = selectedSession;
										closeSessionActions();
										void onDeleteSession(session.id).catch((error) => {
											window.alert(error instanceof Error ? error.message : "Failed to delete chat.");
										});
									}}
								>
									<Trash className="h-4.5 w-4.5" strokeWidth={1.9} aria-hidden="true" />
									<span>{selectedSession.busy ? "Chat is currently running" : "Delete chat"}</span>
								</button>
							</div>
						</>
					) : null}
				</DialogContent>
			</Dialog>

			<Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
				<DialogContent aria-describedby="sidebar-settings-description">
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
						<DialogDescription id="sidebar-settings-description">
							Choose an action.
						</DialogDescription>
					</DialogHeader>

					<div className="overflow-hidden rounded-xl border border-black/8">
						<button
							type="button"
							className="flex w-full items-center gap-3 border-b border-black/8 px-3.5 py-3 text-left text-sm font-medium transition-colors hover:bg-black/4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
							onClick={() => {
								setSettingsDialogOpen(false);
								onOpenSettings?.();
								onClose?.();
							}}
						>
							<Settings className="h-4.5 w-4.5 text-slate-500" strokeWidth={1.9} aria-hidden="true" />
							<span>Settings page</span>
						</button>

						<button
							type="button"
							className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm font-medium transition-colors hover:bg-black/4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring disabled:cursor-default disabled:text-slate-500 disabled:hover:bg-transparent"
							disabled={sessionIdsNeedingSync.size === 0}
							onClick={() => {
								if (sessionIdsNeedingSync.size === 0) {
									return;
								}
								onSyncAllChats();
								setSettingsDialogOpen(false);
							}}
						>
							<CloudSync className="h-4.5 w-4.5 text-slate-500" strokeWidth={1.9} aria-hidden="true" />
							<span>{sessionIdsNeedingSync.size === 0 ? "All chats are up to date" : "Sync all chats"}</span>
						</button>
					</div>
				</DialogContent>
			</Dialog>
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
	onSyncAllChats,
	onActivateSession,
	onDeleteSession,
	onLoadMoreSessions,
	target,
	clientConnected,
	clientConnecting,
	hostConnected,
}: SidebarProps) {
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [mobileDragX, setMobileDragX] = useState(0);
	const [mobileDragging, setMobileDragging] = useState(false);
	const [mobileClosing, setMobileClosing] = useState(false);
	const swipeStart = useRef<{
		x: number;
		y: number;
		startedAt: number;
		axis: "horizontal" | "vertical" | null;
	} | null>(null);

	const closeMobileMenu = () => {
		if (mobileClosing) {
			return;
		}
		setMobileDragging(false);
		setMobileClosing(true);
		setMobileDragX(-window.innerWidth);
	};

	const openMobileMenu = () => {
		setMobileDragX(0);
		setMobileClosing(false);
		setMobileMenuOpen(true);
	};

	const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
		if (mobileClosing) {
			return;
		}
		const touch = event.touches[0];
		if (touch) {
			swipeStart.current = {
				x: touch.clientX,
				y: touch.clientY,
				startedAt: performance.now(),
				axis: null,
			};
		}
	};

	const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
		const start = swipeStart.current;
		const touch = event.touches[0];
		if (!start || !touch) {
			return;
		}

		const deltaX = touch.clientX - start.x;
		const deltaY = touch.clientY - start.y;
		if (!start.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
			start.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
		}
		if (start.axis !== "horizontal") {
			return;
		}

		event.preventDefault();
		setMobileDragging(true);
		setMobileDragX(Math.max(-window.innerWidth, Math.min(0, deltaX)));
	};

	const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
		const start = swipeStart.current;
		const touch = event.changedTouches[0];
		swipeStart.current = null;
		if (!start || !touch || start.axis !== "horizontal") {
			return;
		}

		const distance = Math.max(0, start.x - touch.clientX);
		const elapsed = Math.max(1, performance.now() - start.startedAt);
		const velocity = distance / elapsed;
		if (distance >= window.innerWidth * 0.25 || (distance >= 32 && velocity >= 0.5)) {
			closeMobileMenu();
			return;
		}

		setMobileDragging(false);
		setMobileDragX(0);
	};

	const handleTouchCancel = () => {
		swipeStart.current = null;
		setMobileDragging(false);
		setMobileDragX(0);
	};

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
					onClick={openMobileMenu}
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
					<MessageCircle className="h-4 w-4" strokeWidth={2.3} aria-hidden="true" />
				</button>
			</div>

			{mobileMenuOpen ? (
				<div className="fixed inset-0 z-50 min-[721px]:hidden">
					<aside
						className="absolute inset-0 flex w-full touch-pan-y flex-col overflow-hidden bg-white text-ink shadow-[12px_0_30px_rgba(0,0,0,0.12)]"
						style={{
							transform: `translate3d(${mobileDragX}px, 0, 0)`,
							transition: mobileDragging ? "none" : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
						}}
						onTouchStart={handleTouchStart}
						onTouchMove={handleTouchMove}
						onTouchEnd={handleTouchEnd}
						onTouchCancel={handleTouchCancel}
						onTransitionEnd={(event) => {
							if (event.target === event.currentTarget && mobileClosing) {
								setMobileMenuOpen(false);
								setMobileClosing(false);
								setMobileDragX(0);
							}
						}}
						aria-label="Chat menu"
					>
						<SidebarContent
							pendingDraft={pendingDraft}
							sessions={sessions}
							sessionIdsNeedingSync={sessionIdsNeedingSync}
							loadingMoreSessions={loadingMoreSessions}
							canLoadMoreSessions={canLoadMoreSessions}
							activeSessionId={activeSessionId}
							onStartNewChat={onStartNewChat}
							onOpenSettings={onOpenSettings}
							onSyncAllChats={onSyncAllChats}
							onActivateSession={onActivateSession}
							onDeleteSession={onDeleteSession}
							onLoadMoreSessions={onLoadMoreSessions}
							target={target}
							clientConnected={clientConnected}
							clientConnecting={clientConnecting}
							hostConnected={hostConnected}
							onClose={closeMobileMenu}
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
					onSyncAllChats={onSyncAllChats}
					onActivateSession={onActivateSession}
					onDeleteSession={onDeleteSession}
					onLoadMoreSessions={onLoadMoreSessions}
					target={target}
					clientConnected={clientConnected}
					clientConnecting={clientConnecting}
					hostConnected={hostConnected}
				/>
			</aside>
		</>
	);
});
