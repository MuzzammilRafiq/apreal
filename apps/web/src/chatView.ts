import type { SessionSummary, TranscriptMessage, TranscriptToolCall } from "./chatTypes";

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
		"group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
		isActive
			? "bg-ink-soft text-ink"
			: "text-muted hover:bg-ink-soft hover:text-ink",
	].join(" ");
}

export function getMessageClassName(message: TranscriptMessage): string {
	const baseClassName = "flex w-full flex-col gap-2.5 animate-message-enter max-w-full min-[861px]:max-w-[85%]";

		switch (message.role) {
			case "user":
				return `${baseClassName} ml-auto items-end`;
			case "assistant":
				return `${baseClassName} mr-auto border-b border-line-soft pb-5`;
			case "system":
				return `${baseClassName} mx-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5 text-center`;
			case "error":
				return `${baseClassName} mr-auto rounded-lg border border-slate-300 bg-slate-100 px-4 py-3.5`;
			default:
				return baseClassName;
		}
}

export function getMessageRoleClassName(role: TranscriptMessage["role"]): string {
	const baseClassName = "font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em]";

	switch (role) {
		case "system":
			return "hidden";
		case "error":
			return `${baseClassName} text-red-600`;
		default:
			return `${baseClassName} text-faint`;
	}
}

export function getMessageBodyClassName(role: TranscriptMessage["role"], pending: boolean): string {
	const pendingClassName = pending ? " opacity-75" : "";

	switch (role) {
		case "user":
			return `w-fit max-w-full whitespace-pre-wrap break-words rounded-lg rounded-tr-sm bg-[#171717] px-4 py-2.5 text-[0.95rem] leading-[1.6] text-white transition-colors duration-150 hover:bg-black max-[520px]:px-3.5 max-[520px]:py-2.5${pendingClassName}`;
		case "system":
			return `whitespace-pre-wrap break-words text-[0.84rem] font-medium text-muted${pendingClassName}`;
		case "assistant":
			return `w-full break-words text-[0.95rem] leading-[1.7] text-ink${pendingClassName}`;
		case "error":
			return `whitespace-pre-wrap break-words text-[0.92rem] leading-[1.65] font-medium text-slate-800${pendingClassName}`;
		default:
			return `whitespace-pre-wrap break-words text-[0.95rem] leading-[1.65]${pendingClassName}`;
	}
}

export function getToolStatusClassName(status: TranscriptToolCall["status"]): string {
	const baseClassName = "flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.08em]";

	switch (status) {
		case "running":
			return `${baseClassName} border-slate-300 bg-slate-100 text-slate-700`;
		case "failed":
			return `${baseClassName} border-slate-400 bg-slate-200 text-slate-800`;
		default:
			return `${baseClassName} border-slate-300 bg-white text-slate-700`;
	}
}
