import type { SessionSummary, TranscriptMessage, TranscriptMessageSegment } from "../chatTypes";
import {
	ChainOfThought,
	ChainOfThoughtContent,
	ChainOfThoughtHeader,
	ChainOfThoughtStep,
} from "./ai-elements/chain-of-thought";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "./ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "./ai-elements/message";
import { Brain, TerminalSquare, Wrench } from "lucide-react";

type TranscriptTextOnlySegment = Extract<TranscriptMessageSegment, { type: "text" }>;
type TranscriptReasoningSegment = Exclude<TranscriptMessageSegment, { type: "text" }>;

function isTextSegment(segment: TranscriptMessageSegment): segment is TranscriptTextOnlySegment {
	return segment.type === "text";
}

function isReasoningSegment(segment: TranscriptMessageSegment): segment is TranscriptReasoningSegment {
	return segment.type !== "text";
}

function mergeConsecutiveThinkingSegments(segments: TranscriptReasoningSegment[]): TranscriptReasoningSegment[] {
	const merged: TranscriptReasoningSegment[] = [];

	for (const segment of segments) {
		const previous = merged.at(-1);
		if (segment.type === "thinking" && previous?.type === "thinking") {
			merged[merged.length - 1] = {
				...previous,
				content: previous.content
					? `${previous.content}${previous.content.endsWith("\n") || segment.content.startsWith("\n") ? "" : "\n"}${segment.content}`
					: segment.content,
				updatedAt: Math.max(previous.updatedAt, segment.updatedAt),
			};
			continue;
		}

		merged.push(segment);
	}

	return merged;
}

function mergeConsecutiveAssistantMessages(transcript: TranscriptMessage[]): TranscriptMessage[] {
	const merged: TranscriptMessage[] = [];

	for (const item of transcript) {
		const previous = merged.at(-1);
		if (item.role !== "assistant" || previous?.role !== "assistant") {
			merged.push(item);
			continue;
		}

		merged[merged.length - 1] = {
			...previous,
			body: [previous.body, item.body].filter(Boolean).join(""),
			thinking: [previous.thinking, item.thinking].filter(Boolean).join(""),
			modelLabel: item.modelLabel ?? previous.modelLabel,
			modelSource: item.modelSource ?? previous.modelSource,
			toolCalls: [...previous.toolCalls, ...item.toolCalls],
			segments: [...previous.segments, ...item.segments],
			pending: previous.pending || item.pending,
			createdAt: Math.min(previous.createdAt, item.createdAt),
		};
	}

	return merged;
}

type EmptyState = {
	title: string;
	body: string | null;
};

type TranscriptPanelProps = {
	activeSession: SessionSummary | null;
	activeTranscript: TranscriptMessage[];
	emptyState: EmptyState | null;
	connectionError: string | null;
};

function AssistantMarkdownMessage({ content, pending }: { content: string; pending: boolean }) {
	return (
		<MessageResponse
			className={[
				"markdown-content w-full wrap-break-word text-[0.95rem] leading-[1.7] text-ink selection:bg-black/10 selection:text-black",
				pending ? "opacity-75" : "",
			].join(" ")}
		>
			{content}
		</MessageResponse>
	);
}

function getReasoningStepStatus(segment: TranscriptReasoningSegment): "complete" | "active" | "pending" {
	if (segment.type === "thinking") {
		return "complete";
	}

	switch (segment.status) {
		case "running":
			return "active";
		case "failed":
			return "pending";
		default:
			return "complete";
	}
}

function AssistantReasoningBlock({ item, segments }: { item: TranscriptMessage; segments: TranscriptReasoningSegment[] }) {
	const mergedSegments = mergeConsecutiveThinkingSegments(segments);
	const liveThinkingSegmentId = item.pending
		? [...mergedSegments].reverse().find((segment) => segment.type === "thinking")?.id ?? null
		: null;

	return (
		<ChainOfThought
			defaultOpen={item.pending}
			className="w-full "
		>
			<ChainOfThoughtHeader />
			<ChainOfThoughtContent>
				{mergedSegments.map((segment) => {
					if (segment.type === "thinking") {
						const isLiveThinking = segment.id === liveThinkingSegmentId;

						return (
							<ChainOfThoughtStep
								key={segment.id}
								icon={Brain}
								label={isLiveThinking ? "Thinking live" : "Thinking"}
								status={isLiveThinking ? "active" : "complete"}
							>
								<pre className="overflow-x-auto font-mono text-[0.78rem] leading-5 whitespace-pre-wrap wrap-break-word text-[#3f3f46]">
									{segment.content}
								</pre>
							</ChainOfThoughtStep>
						);
					}

					const isBashCall = segment.name === "bash";

					return (
						<ChainOfThoughtStep
							key={segment.id}
							icon={isBashCall ? TerminalSquare : Wrench}
							label={segment.name}
							status={getReasoningStepStatus(segment)}
							showStatus={segment.status !== "completed"}
						>
							{segment.summary ? (
								<pre className="overflow-x-auto font-mono text-[0.78rem] leading-5 whitespace-pre-wrap wrap-break-word text-[#3f3f46]">
									{segment.summary}
								</pre>
							) : null}
						</ChainOfThoughtStep>
					);
				})}
			</ChainOfThoughtContent>
		</ChainOfThought>
	);
}

function TranscriptMessageCard({ item }: { item: TranscriptMessage }) {
	const assistantSegments = item.role === "assistant" ? item.segments : [];
	const assistantTextSegments = assistantSegments.filter(isTextSegment);
	const assistantReasoningSegments = assistantSegments.filter(isReasoningSegment);
	const shouldShowPlaceholder = item.pending && !item.body && assistantSegments.length === 0;
	const shouldShowStandaloneBody = item.role !== "assistant" && (item.body || shouldShowPlaceholder);
	const shouldShowAssistantBodyFallback = item.role === "assistant" && assistantTextSegments.length === 0 && Boolean(item.body);
	const messageFrom = item.role === "user" ? "user" : "assistant";
	const messageClassName = [
		"animate-message-enter max-w-full min-[861px]:max-w-[85%]",
		item.role === "assistant" ? "mr-auto pb-5" : "",
		item.role === "system" ? "mx-auto border-l border-black/10 pl-4 text-left" : "",
		item.role === "error" ? "mr-auto border-l-2 border-black/25 pl-4" : "",
	].join(" ");

	return (
		<Message from={messageFrom} className={messageClassName}>
			{shouldShowStandaloneBody && (
				<MessageContent
					className={[
						item.role === "user"
							? "rounded-2xl rounded-tr-md bg-black px-4 py-2.5 text-[0.95rem] leading-[1.6] text-white transition-colors duration-150 hover:bg-black/90 max-[520px]:px-3.5 max-[520px]:py-2.5"
							: "bg-transparent p-0 text-[0.9rem] font-medium leading-[1.65] text-muted",
						item.pending ? "opacity-75" : "",
					].join(" ")}
				>
					<p className="whitespace-pre-wrap wrap-break-word">{item.body || "Thinking..."}</p>
				</MessageContent>
			)}
			{item.role === "assistant" && shouldShowPlaceholder && (
				<MessageContent className="bg-transparent p-0">
					<div className="flex items-center gap-2 py-1 font-medium text-slate-500">
						<svg className="h-4 w-4 animate-spin text-slate-600" fill="none" viewBox="0 0 24 24">
							<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
							<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.002 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
						</svg>
						<span className="text-sm">Thinking...</span>
					</div>
				</MessageContent>
			)}

			{shouldShowAssistantBodyFallback && (
				<MessageContent className="w-full bg-transparent p-0">
					<AssistantMarkdownMessage content={item.body} pending={item.pending} />
				</MessageContent>
			)}

			{item.role === "assistant" && assistantSegments.length > 0 && (
				<MessageContent className="w-full bg-transparent p-0">
					<div className="flex w-full flex-col gap-3">
						{assistantReasoningSegments.length > 0 ? (
							<AssistantReasoningBlock item={item} segments={assistantReasoningSegments} />
						) : null}
						{assistantTextSegments.map((segment) => (
							<AssistantMarkdownMessage key={segment.id} content={segment.content} pending={item.pending} />
						))}
					</div>
				</MessageContent>
			)}
		</Message>
	);
}

export function TranscriptPanel({ activeTranscript, emptyState, connectionError }: TranscriptPanelProps) {
	const renderedTranscript = mergeConsecutiveAssistantMessages(activeTranscript);

	return (
		<div className="min-h-0 min-w-0 flex-1 bg-white">
			<Conversation
				id="transcript"
				className="h-full"
				aria-live="polite"
			>
				<ConversationContent className="gap-5 px-3 pt-4 pb-28 min-[861px]:gap-6 min-[861px]:px-6 min-[861px]:pt-6 min-[861px]:pb-32">
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
						<ConversationEmptyState
							className="mx-auto my-auto w-full px-2 py-[8vh] min-[861px]:max-w-xl min-[861px]:px-4 min-[861px]:py-[10vh]"
							title={emptyState.title}
							description={emptyState.body}
							icon={
								<svg viewBox="0 0 24 24" className="h-8 w-8 text-black min-[861px]:h-10 min-[861px]:w-10" fill="none" stroke="currentColor" strokeWidth="2.2">
									<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							}
						/>
					) : (
						renderedTranscript.map((item) => <TranscriptMessageCard key={item.id} item={item} />)
					)}
				</ConversationContent>
				<ConversationScrollButton className="bottom-24 border-(--color-brand-line) bg-white text-(--color-brand-ink) hover:bg-(--color-brand-hover) min-[861px]:bottom-28" />
			</Conversation>
		</div>
	);
}
