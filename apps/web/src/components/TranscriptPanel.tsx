import type { RefObject } from "react";
import type { SessionSummary, TranscriptMessage } from "../chatTypes";
import {
	formatRole,
	formatToolStatus,
	getMessageBodyClassName,
	getMessageClassName,
	getMessageRoleClassName,
	getToolStatusClassName,
} from "../chatView";

type EmptyState = {
	title: string;
	body: string;
};

type TranscriptPanelProps = {
	transcriptRef: RefObject<HTMLDivElement | null>;
	activeSession: SessionSummary | null;
	activeTranscript: TranscriptMessage[];
	emptyState: EmptyState | null;
};

function TranscriptMessageCard({ item }: { item: TranscriptMessage }) {
	const shouldShowPlaceholder = item.pending && !item.body && !item.thinking.trim() && item.toolCalls.length === 0;

	return (
		<article className={getMessageClassName(item)}>
			<p className={getMessageRoleClassName(item.role)}>{formatRole(item.role)}</p>
			{(item.body || shouldShowPlaceholder) && (
				<p className={getMessageBodyClassName(item.role, item.pending)}>{item.body || "Thinking..."}</p>
			)}

			{item.role === "assistant" && item.toolCalls.length > 0 && (
				<section className="mt-0.5 flex flex-col gap-3 border border-line-soft bg-tool-surface px-4.5 py-4">
					<p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-faint">Tool calls</p>
					<div className="flex flex-col gap-2.5">
						{item.toolCalls.map((toolCall) => (
							<div
								key={toolCall.id}
								className="flex flex-col gap-1.5 border-b border-line-soft pb-2.5 last:border-b-0 last:pb-0"
							>
								<div className="flex items-center justify-between gap-3">
									<p className="font-mono text-[0.84rem] text-ink">{toolCall.name}</p>
									<span className={getToolStatusClassName(toolCall.status)}>{formatToolStatus(toolCall.status)}</span>
								</div>
								<p className="font-mono whitespace-pre-wrap wrap-break-word text-[0.78rem] leading-[1.65] text-muted">
									{toolCall.summary}
								</p>
							</div>
						))}
					</div>
				</section>
			)}

			{item.role === "assistant" && item.thinking.trim() && (
				<details
					className="mt-3 border border-thinking-border bg-thinking-surface px-4 py-3.5 text-muted open:bg-thinking-surface-open"
					open={item.pending}
				>
					<summary className="cursor-pointer list-none font-mono text-[0.74rem] uppercase tracking-[0.12em] text-thinking-label [&::-webkit-details-marker]:hidden">
						{item.pending ? "Thinking trace (live)" : "Thinking trace"}
					</summary>
					<pre className="mt-3 whitespace-pre-wrap wrap-break-word font-mono text-[0.82rem] leading-[1.7] text-thinking-body">
						{item.thinking}
					</pre>
				</details>
			)}
		</article>
	);
}

export function TranscriptPanel({ transcriptRef, activeTranscript, emptyState }: TranscriptPanelProps) {
	return (
		<div className="min-h-0 min-w-0 flex-1 bg-stage">
			<div
				ref={transcriptRef}
				id="transcript"
				className="flex h-full flex-col gap-6.5 overflow-y-auto px-8 pt-8.5 pb-10.5 max-[860px]:px-5"
				aria-live="polite"
			>
				{emptyState ? (
					<div className="my-auto flex max-w-xl flex-col gap-3.5 py-[8vh]">
						<p className="text-[clamp(2rem,4vw,3.4rem)] font-bold leading-[0.98] tracking-[-0.07em]">
							{emptyState.title}
						</p>
						<p className="max-w-lg text-base leading-[1.8] text-muted">{emptyState.body}</p>
					</div>
				) : (
					activeTranscript.map((item) => <TranscriptMessageCard key={item.id} item={item} />)
				)}
			</div>
		</div>
	);
}
