import { Children, isValidElement, type ReactNode, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { SessionSummary, TranscriptMessage, TranscriptMessageSegment } from "../chatTypes";
import {
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
	connectionError: string | null;
};

function getCodeBlockLanguage(children: ReactNode) {
	const child = Children.toArray(children)[0];
	if (!isValidElement<{ className?: string }>(child)) {
		return null;
	}

	const className = child.props.className ?? "";
	const languageMatch = className.match(/language-([\w-]+)/);

	return languageMatch?.[1] ?? null;
}

function AssistantMarkdownMessage({ content, pending }: { content: string; pending: boolean }) {
	return (
		<div
			className={[
				getMessageBodyClassName("assistant", pending),
				"markdown-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
			].join(" ")}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
				components={{
					pre({ children, ...props }) {
						const language = getCodeBlockLanguage(children);

						return (
							<div className="code-block" data-language={language ?? "code"}>
								<pre {...props}>{children}</pre>
							</div>
						);
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}

function AssistantSegmentBlock({ item, segment, isLiveThinking }: { item: TranscriptMessage; segment: TranscriptMessageSegment; isLiveThinking: boolean }) {
	if (segment.type === "text") {
		return <AssistantMarkdownMessage content={segment.content} pending={item.pending} />;
	}

	if (segment.type === "tool_call") {
		return (
			<section className="mt-0.5 flex w-full flex-col gap-3 border border-line-soft bg-tool-surface px-4.5 py-4">
				<p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-faint">Tool call</p>
				<div className="flex items-center justify-between gap-3">
					<p className="font-mono text-[0.84rem] text-ink">{segment.name}</p>
					<span className={getToolStatusClassName(segment.status)}>{formatToolStatus(segment.status)}</span>
				</div>
			</section>
		);
	}

	return (
		<details
			className="mt-3 w-full border border-thinking-border bg-thinking-surface px-4 py-3.5 text-muted open:bg-thinking-surface-open"
			open={isLiveThinking}
		>
			<summary className="cursor-pointer list-none font-mono text-[0.74rem] uppercase tracking-[0.12em] text-thinking-label [&::-webkit-details-marker]:hidden">
				{isLiveThinking ? "Thinking trace (live)" : "Thinking trace"}
			</summary>
			<pre className="mt-3 whitespace-pre-wrap wrap-break-word font-mono text-[0.82rem] leading-[1.7] text-thinking-body">
				{segment.content}
			</pre>
		</details>
	);
}

function TranscriptMessageCard({ item }: { item: TranscriptMessage }) {
	const assistantSegments = item.role === "assistant" ? item.segments : [];
	const liveThinkingSegmentId = item.pending
		? [...assistantSegments].reverse().find((segment) => segment.type === "thinking")?.id ?? null
		: null;
	const shouldShowPlaceholder = item.pending && !item.body && assistantSegments.length === 0;
	const shouldShowStandaloneBody = item.role !== "assistant" && (item.body || shouldShowPlaceholder);
	const shouldShowAssistantBodyFallback = item.role === "assistant" && assistantSegments.length === 0 && Boolean(item.body);
	const assistantModelMeta = item.modelLabel || item.modelSource;
	const shouldShowAssistantMeta = item.role === "assistant" && Boolean(assistantModelMeta);

	return (
		<article className={getMessageClassName(item)}>
			{shouldShowStandaloneBody && (
				<p className={getMessageBodyClassName(item.role, item.pending)}>{item.body || "Thinking..."}</p>
			)}
			{item.role === "assistant" && shouldShowPlaceholder && (
				<p className={getMessageBodyClassName(item.role, item.pending)}>Thinking...</p>
			)}

			{shouldShowAssistantBodyFallback && (
				<AssistantMarkdownMessage content={item.body} pending={item.pending} />
			)}

			{item.role === "assistant" && assistantSegments.length > 0 && (
				<div className="flex w-full flex-col gap-3">
					{assistantSegments.map((segment) => (
						<AssistantSegmentBlock
							key={segment.id}
							item={item}
							segment={segment}
							isLiveThinking={segment.type === "thinking" && segment.id === liveThinkingSegmentId}
						/>
					))}
				</div>
			)}

			{shouldShowAssistantMeta ? (
				<footer className="mt-1 border-t border-line-soft pt-3 text-[0.72rem] leading-5 text-muted">
					<p className="break-words">{assistantModelMeta}</p>
				</footer>
			) : null}
		</article>
	);
}

export function TranscriptPanel({ transcriptRef, activeTranscript, emptyState, connectionError }: TranscriptPanelProps) {
	return (
		<div className="min-h-0 min-w-0 flex-1 bg-stage">
			<div
				ref={transcriptRef}
				id="transcript"
				className="flex h-full flex-col gap-6.5 overflow-y-auto px-8 pt-8.5 pb-44 max-[860px]:px-5 max-[860px]:pb-48"
				aria-live="polite"
			>
				{connectionError ? (
					<div
						role="alert"
						className="mr-auto w-full max-w-3xl border-l-2 border-danger bg-danger-soft px-4.5 py-4 text-base leading-[1.78] text-ink max-[520px]:px-3.75 max-[520px]:py-3.5"
					>
						{connectionError}
					</div>
				) : null}
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
