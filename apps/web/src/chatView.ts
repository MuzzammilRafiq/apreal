import type { SessionSummary, TranscriptMessage, TranscriptToolCall } from "./chatTypes";

export function formatRole(role: TranscriptMessage["role"]): string {
	switch (role) {
		case "user":
			return "You";
		case "assistant":
			return "Assistant";
		case "error":
			return "Error";
		default:
			return "System";
	}
}

export function formatRelativeTime(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const sameDay = date.toDateString() === now.toDateString();
	return sameDay
		? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		: date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatToolStatus(status: TranscriptToolCall["status"]): string {
	switch (status) {
		case "running":
			return "Running";
		case "failed":
			return "Failed";
		default:
			return "Completed";
}
}

export function formatSessionState(session: SessionSummary | null, pendingDraft: boolean): string {
	if (!session) {
		return pendingDraft ? "Starting" : "Draft";
	}

	return session.busy ? "Running" : "Saved";
}

export function getSessionCardClassName(isActive: boolean): string {
	return [
		"flex w-full cursor-pointer flex-col gap-2 border-t border-b bg-transparent px-3 pt-[15px] pb-[14px] text-left text-sidebar-ink transition-colors duration-150 hover:bg-sidebar-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
		isActive
			? "border-t-white/15 border-b-white/20 bg-sidebar-active"
			: "border-t-transparent border-b-sidebar-line",
	].join(" ");
}

export function getMessageClassName(message: TranscriptMessage): string {
	const baseClassName = "flex max-w-[min(100%,920px)] flex-col gap-2.5 animate-message-enter";

	switch (message.role) {
		case "user":
			return `${baseClassName} w-full self-end min-[521px]:max-w-[72%] max-[1220px]:min-[521px]:max-w-[76%] max-[860px]:min-[521px]:max-w-[82%]`;
		case "assistant":
			return `${baseClassName} self-stretch border-b border-line-soft pb-[22px]`;
		case "system":
			return `${baseClassName} max-w-full self-stretch text-center`;
		case "error":
			return `${baseClassName} self-stretch border-l-2 border-danger bg-danger-soft px-[18px] py-4 max-[520px]:px-[15px] max-[520px]:py-[14px]`;
		default:
			return baseClassName;
	}
}

export function getMessageRoleClassName(role: TranscriptMessage["role"]): string {
	const baseClassName = "font-mono text-[0.72rem] font-medium uppercase tracking-[0.12em]";

	switch (role) {
		case "system":
			return "hidden";
		case "error":
			return `${baseClassName} text-danger`;
		default:
			return `${baseClassName} text-faint`;
	}
}

export function getMessageBodyClassName(role: TranscriptMessage["role"], pending: boolean): string {
	const pendingClassName = pending ? " opacity-[0.62]" : "";

	switch (role) {
		case "user":
			return `whitespace-pre-wrap break-words bg-ink px-[18px] py-4 text-base leading-[1.78] text-sidebar-ink max-[520px]:px-[15px] max-[520px]:py-[14px]${pendingClassName}`;
		case "system":
			return `whitespace-pre-wrap break-words text-[0.84rem] text-muted${pendingClassName}`;
		case "assistant":
			return `whitespace-pre-wrap break-words text-base leading-[1.78] text-ink${pendingClassName}`;
		case "error":
			return `whitespace-pre-wrap break-words text-base leading-[1.78] text-ink${pendingClassName}`;
		default:
			return `whitespace-pre-wrap break-words text-base leading-[1.78]${pendingClassName}`;
	}
}

export function getToolStatusClassName(status: TranscriptToolCall["status"]): string {
	const baseClassName = "rounded-full border px-[7px] py-[3px] font-mono text-[0.68rem] uppercase tracking-[0.08em]";

	switch (status) {
		case "running":
			return `${baseClassName} border-accent-line bg-accent-soft text-accent`;
		case "failed":
			return `${baseClassName} border-danger-line bg-danger-soft text-danger`;
		default:
			return `${baseClassName} border-line bg-ink-soft text-muted`;
	}
}
