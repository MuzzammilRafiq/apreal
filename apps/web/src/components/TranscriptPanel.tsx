import { Children, isValidElement, type ReactNode } from "react";
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
				"markdown-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 selection:bg-black/10 selection:text-black",
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
			<section className="mt-1 flex w-full flex-col gap-2 border-l border-black/10 pl-3">
				<div className="flex items-center gap-2">
					<span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm bg-black/[0.05] text-slate-700">
						<svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
							<path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</span>
					<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-500">Tool Execution</p>
				</div>
				<div className="flex items-center justify-between gap-2.5">
					<p className="truncate font-mono text-[0.8rem] font-medium text-slate-800">
						{segment.name}
					</p>
					<span className={getToolStatusClassName(segment.status)}>{formatToolStatus(segment.status)}</span>
				</div>
			</section>
		);
	}

	return (
		<details
			className="mt-2.5 w-full border-l border-black/10 pl-3 text-[#525252] transition-colors duration-150"
			open={isLiveThinking}
		>
			<summary className="flex cursor-pointer list-none items-center justify-between font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-500 select-none [&::-webkit-details-marker]:hidden">
				<span className="flex items-center gap-2">
					<span className="flex h-4.5 w-4.5 items-center justify-center rounded-sm bg-black/[0.05] text-slate-600">
						<svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
							<circle cx="12" cy="12" r="10" />
							<path d="M12 16v-4M12 8h.01" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</span>
					{isLiveThinking ? "Thinking Process (Live)" : "Thinking Process"}
				</span>
				<span className="shrink-0 text-[0.64rem] font-medium text-slate-500">Toggle</span>
			</summary>
			<pre className="mt-2 whitespace-pre-wrap break-words bg-white px-3 py-2.5 font-mono text-[0.78rem] leading-[1.6] text-[#525252]">
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
				<div className="flex items-center gap-2 py-1 font-medium text-slate-500">
					<svg className="h-4 w-4 animate-spin text-slate-600" fill="none" viewBox="0 0 24 24">
						<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
						<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.002 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
					</svg>
					<span className="text-sm">Thinking...</span>
				</div>
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
				<footer className="mt-1 flex items-center gap-1.5 border-t border-slate-200 pt-2.5 font-mono text-[0.68rem] font-medium leading-5 text-slate-500">
					<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5">
						<path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-7 11.2a7.99 7.99 0 0 0 14 0" strokeLinecap="round" />
					</svg>
					<p className="break-all">{assistantModelMeta}</p>
				</footer>
			) : null}
		</article>
	);
}

export function TranscriptPanel({ activeTranscript, emptyState, connectionError }: TranscriptPanelProps) {
	return (
		<div className="min-h-0 min-w-0 flex-1 bg-white">
			<div
				id="transcript"
				className="flex h-full flex-col gap-5 overflow-y-auto px-3 pt-4 pb-28 min-[861px]:gap-6 min-[861px]:px-6 min-[861px]:pt-6 min-[861px]:pb-32"
				aria-live="polite"
			>
				{connectionError ? (
					<div
						role="alert"
						className="mr-auto flex w-full items-start gap-3 border-l-2 border-black/25 bg-white px-4 py-3 text-[0.9rem] font-medium leading-[1.6] text-slate-800 min-[861px]:max-w-3xl"
					>
						<svg viewBox="0 0 24 24" className="mt-0.5 h-4.5 w-4.5 shrink-0 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2.2">
							<circle cx="12" cy="12" r="10" />
							<path d="M12 8v4M12 16h.01" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						<span>{connectionError}</span>
					</div>
				) : null}
				{emptyState ? (
					<div className="mx-auto my-auto flex w-full flex-col items-center justify-center gap-4 px-2 py-[8vh] text-center min-[861px]:max-w-xl min-[861px]:px-4 min-[861px]:py-[10vh]">
						<div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/85 shadow-[0_12px_30px_rgba(0,0,0,0.05)]">
							<svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-700" fill="none" stroke="currentColor" strokeWidth="2.2">
								<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</div>
						<div>
							<h1 className="text-[clamp(1.55rem,3.5vw,2.1rem)] font-bold leading-tight tracking-tight text-slate-900">
								{emptyState.title}
							</h1>
							<p className="mx-auto mt-2 w-full text-[0.92rem] font-medium leading-[1.65] text-slate-500 min-[861px]:max-w-md">
								{emptyState.body}
							</p>
						</div>
					</div>
				) : (
					activeTranscript.map((item) => <TranscriptMessageCard key={item.id} item={item} />)
				)}
			</div>
		</div>
	);
}
