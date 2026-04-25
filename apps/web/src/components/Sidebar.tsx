import { memo } from "react";
import type { SessionSummary } from "../chatTypes";
import { formatRelativeTime, getSessionCardClassName } from "../chatView";
import type { RelayPairingStateMessage } from "@apreal/shared";

type SidebarProps = {
	connected: boolean;
	pendingDraft: boolean;
	pairingState: RelayPairingStateMessage | null;
	sessions: SessionSummary[];
	activeSessionId: string | null;
	sessionState: string;
	onStartNewChat: () => void;
	onActivateSession: (sessionId: string) => void;
};

export const Sidebar = memo(function Sidebar({
	connected,
	pendingDraft,
	pairingState,
	sessions,
	activeSessionId,
	sessionState,
	onStartNewChat,
	onActivateSession,
}: SidebarProps) {
	return (
		<aside className="flex h-full min-h-0 flex-col border-b border-white/10 bg-sidebar-bg text-sidebar-ink min-[721px]:border-r min-[721px]:border-b-0">
			<div className="border-b border-white/10 px-6 pt-7 pb-6 max-[860px]:px-5">
				{pairingState && pairingState.status !== "paired" ? (
					<div className="border border-white/10 bg-sidebar-panel px-4 py-4 text-sm leading-6 text-sidebar-muted">
						<p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em] text-sidebar-muted">
							Relay Pairing Code
						</p>
						<p className="mt-2 font-mono text-lg font-semibold tracking-[0.2em] text-sidebar-ink">
							{pairingState.pairingCode ?? "Issuing..."}
						</p>
						<p className="mt-2 text-[0.82rem] leading-[1.6]">
							Paste this into the agent server once. Future reconnects reuse the saved pairing.
						</p>
					</div>
				) : null}
				<button
					type="button"
					id="new-chat-button"
					className={[
						`${pairingState && pairingState.status !== "paired" ? "mt-4" : "mt-6"} w-full border border-white/15 bg-sidebar-surface px-4 py-3.5 text-left text-[0.92rem] font-medium text-sidebar-ink transition duration-150 hover:border-white/25 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40`,
						!activeSessionId && !pendingDraft ? "border-white/25 bg-white/8" : "",
					].join(" ")}
					onClick={onStartNewChat}
				>
					Start new chat
				</button>
			</div>
			<div className="max-[720px]:max-h-[34svh] flex-1 overflow-y-auto px-4.5 pt-5 pb-6">
				<div className="flex items-baseline justify-between gap-3 px-1.5 pb-3">
					<p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-sidebar-muted">
						Sessions
					</p>
					<p id="session-count" className="text-[0.82rem] text-sidebar-muted">
						{sessions.length}
					</p>
				</div>
				<div id="session-list" className="flex flex-col" aria-label="Chat sessions">
					{sessions.length === 0 ? (
						<p className="border-y border-sidebar-line px-3 py-4 leading-[1.7] text-sidebar-muted">
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
								<div className="flex items-start justify-between gap-3">
									<p className="min-w-0 flex-1 text-[0.94rem] font-medium leading-[1.4] text-sidebar-ink">
										{session.title}
									</p>
									<span className="shrink-0 font-mono text-[0.72rem] text-sidebar-muted">
										{session.busy ? "Running" : formatRelativeTime(session.updatedAt)}
									</span>
								</div>
								<p className="line-clamp-2 text-[0.82rem] leading-[1.6] text-sidebar-muted">
									{session.preview}
								</p>
								<p className="hidden">{session.model || "Model starts on first response"}</p>
							</button>
						))
					)}
				</div>
			</div>
			<div className="border-t border-white/10 bg-sidebar-panel px-6 pt-4.5 pb-5.5 max-[860px]:px-5">
				<p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em] text-sidebar-muted">
					State
				</p>
				<p id="sidebar-status" className="mt-2 text-base font-medium">
					{connected ? "Connected" : "Disconnected - reconnecting..."} · {sessionState}
				</p>
			</div>
		</aside>
	);
});
