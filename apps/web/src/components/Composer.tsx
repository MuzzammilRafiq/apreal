import { memo, useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { SessionSummary } from "../chatTypes";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	type PromptInputMessage,
} from "./ai-elements/prompt-input";

function formatModelLabel(model: string | null): string | null {
	if (!model) {
		return null;
	}

	const condensed = model.split("/").at(-1) ?? model;
	return condensed.replaceAll(/[-_]/g, " ");
}

type ComposerProps = {
  connected: boolean;
  serverReady: boolean;
  streamRequested: boolean;
  blockedReason: string | null;
  connectionLabel: string;
  activeSession: SessionSummary | null;
  activeSessionId: string | null;
  aborting: boolean;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (prompt: string) => boolean;
  onAbort: () => Promise<void>;
};

export const Composer = memo(function Composer({
  connected,
  serverReady,
  streamRequested,
  blockedReason,
  connectionLabel,
  activeSession,
  activeSessionId,
  aborting,
  promptInputRef,
  onSend,
  onAbort,
}: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const canSend = serverReady && !blockedReason && !activeSession?.busy && prompt.trim().length > 0;
  const currentModelLabel = formatModelLabel(activeSession?.model ?? null);

  const resizePromptInput = useCallback(() => {
    const node = promptInputRef.current;
    if (!node) {
      return;
    }

    node.style.height = "auto";
    const computedStyle = window.getComputedStyle(node);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight);
    const paddingTop = Number.parseFloat(computedStyle.paddingTop);
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom);
    const resolvedLineHeight = Number.isFinite(lineHeight) ? lineHeight : 28;
    const maxHeight = resolvedLineHeight * 7 + paddingTop + paddingBottom;

    node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [promptInputRef]);

  useLayoutEffect(() => {
    resizePromptInput();
  }, [prompt, resizePromptInput]);

  useEffect(() => {
    if (!serverReady || blockedReason) {
			return;
		}

    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }, [activeSessionId, blockedReason, promptInputRef, serverReady]);

	function handleSubmit(message: PromptInputMessage) {
		const trimmedPrompt = message.text.trim();
		if (!trimmedPrompt) {
			return;
		}

		if (onSend(trimmedPrompt)) {
			setPrompt("");
		}
	}

	return (
		<PromptInput
			onSubmit={handleSubmit}
			className={[
				"pointer-events-auto mx-auto w-full max-w-[54rem] rounded-xl bg-white shadow-[0_-12px_40px_rgba(15,23,42,0.08)] transition-colors duration-150 [&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:overflow-hidden [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:bg-white",
				isFocused
					? "[&_[data-slot=input-group]]:border-[rgba(15,23,42,0.16)]"
					: "[&_[data-slot=input-group]]:border-black/10",
			].join(" ")}
		>
			<PromptInputBody>
				<PromptInputTextarea
					ref={promptInputRef}
					id="prompt-input"
					name="message"
					aria-label="Prompt input"
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					onFocus={() => setIsFocused(true)}
					onBlur={() => setIsFocused(false)}
					onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
							return;
						}

						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
						}
					}}
					disabled={!serverReady || Boolean(blockedReason)}
					onInput={resizePromptInput}
					placeholder={
						blockedReason
							? blockedReason
							: !serverReady
								? "Start the local server to begin chatting..."
								: !connected
									? streamRequested
										? `Connecting to the ${connectionLabel}...`
										: `Opening the ${connectionLabel} stream...`
									: ""
					}
					className="min-h-[4.5rem] max-h-[calc(11.55em+1rem)] px-4 py-3 text-[0.98rem] leading-[1.6] text-slate-900 placeholder:text-slate-400"
				/>
			</PromptInputBody>
			<PromptInputFooter className="px-3 pb-3 pt-0 min-[861px]:px-4">
				<PromptInputTools className="min-w-0 flex-1">
					{currentModelLabel ? (
						<span className="inline-flex max-w-full items-center rounded-md border border-black/10 bg-slate-50 px-2.5 py-1.5 text-[0.78rem] font-medium text-slate-600">
							<span className="truncate">{currentModelLabel}</span>
						</span>
					) : null}
				</PromptInputTools>
				<PromptInputSubmit
					id={activeSession?.busy ? "abort-button" : "send-button"}
					status={activeSession?.busy ? "streaming" : "ready"}
					onStop={() => {
						void onAbort();
					}}
					variant="default"
					size="icon-sm"
					className="ml-auto h-9 w-9 shrink-0 rounded-md border border-slate-900 bg-slate-900 text-white transition-colors duration-150 hover:border-slate-800 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-30"
					disabled={!serverReady || Boolean(blockedReason) || aborting || (!canSend && !activeSession?.busy)}
					aria-label={activeSession?.busy ? "Stop run" : "Send prompt"}
					title={activeSession?.busy ? (aborting ? "Stopping stream" : "Stop stream") : "Send prompt"}
				/>
			</PromptInputFooter>
		</PromptInput>
  );
});
