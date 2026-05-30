import { memo, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { SessionSummary } from "../chatTypes";

function formatContextCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return value.toString();
}

function formatCurrentContext(session: SessionSummary | null): string | null {
  if (!session) {
    return null;
  }

  const usage = session.contextUsage;
  if (!usage) {
    return session.model ? "Unavailable until next response" : "Waiting for first response";
  }

  if (usage.tokens === null) {
    return `Unknown / ${formatContextCount(usage.contextWindow)} tokens`;
  }

  const percentLabel = usage.percent === null ? "" : ` (${usage.percent.toFixed(1)}%)`;
  return `${formatContextCount(usage.tokens)} / ${formatContextCount(usage.contextWindow)} tokens${percentLabel}`;
}

type ComposerProps = {
  connected: boolean;
  serverReady: boolean;
  streamRequested: boolean;
  connectionLabel: string;
  activeSession: SessionSummary | null;
  activeSessionId: string | null;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (prompt: string) => boolean;
  onAbort: () => void;
};

export const Composer = memo(function Composer({
  connected,
  serverReady,
  streamRequested,
  connectionLabel,
  activeSession,
  activeSessionId,
  promptInputRef,
  onSend,
  onAbort,
}: ComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const canSend = serverReady && !activeSession?.busy && prompt.trim().length > 0;
  const currentContextLabel = formatCurrentContext(activeSession);

  function resizePromptInput() {
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
  }

  useLayoutEffect(() => {
    resizePromptInput();
  }, [prompt]);

  useEffect(() => {
    if (!serverReady) {
			return;
		}

    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }, [activeSessionId, promptInputRef, serverReady]);

  function submitPrompt() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    if (onSend(trimmedPrompt)) {
      setPrompt("");
    }
  }

	return (
		<div
			className={[
				"pointer-events-auto mx-auto flex w-full max-w-[52rem] flex-col gap-1.5 rounded-lg border bg-white/92 px-3 py-2.5 transition-colors duration-150 backdrop-blur-md",
				isFocused
					? "border-slate-400 bg-white"
					: "border-slate-300/90",
			].join(" ")}
		>
			{currentContextLabel ? (
				<div className="flex items-center justify-between gap-2 px-1 pb-1.5 border-b border-slate-200">
					<span className="flex items-center gap-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
						<svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
            Current Context
          </span>
					<span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-right font-mono text-[0.68rem] font-medium text-slate-600">
            {currentContextLabel}
          </span>
        </div>
      ) : null}
			<div className="flex items-end gap-2.5">
        <textarea
          ref={promptInputRef}
          id="prompt-input"
          name="prompt"
          rows={1}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submitPrompt();
            }
          }}
          disabled={!serverReady}
          onInput={resizePromptInput}
          placeholder={
            !serverReady
              ? "Start the local server to begin chatting..."
              : !connected
                ? streamRequested
                  ? `Connecting to the ${connectionLabel}...`
                  : `Opening the ${connectionLabel} stream...`
                : activeSessionId
                  ? "Continue this session with the next task, follow-up, or code request..."
                  : "Describe what you want Pi to inspect, fix, or build..."
          }
				className="min-h-[calc(1.65em+1rem)] max-h-[calc(11.55em+1rem)] flex-1 resize-none overflow-hidden border-none bg-transparent px-1.5 py-1.5 text-[0.94rem] leading-[1.6] text-slate-900 outline-none placeholder:text-slate-400 focus-visible:outline-none"
			/>
			<button
				type="button"
				id={activeSession?.busy ? "abort-button" : "send-button"}
				className={[
					"flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-30",
					activeSession?.busy
						? "bg-slate-700 text-white hover:bg-black"
						: "bg-black text-white hover:bg-slate-800",
				].join(" ")}
          disabled={!serverReady || (!canSend && !activeSession?.busy)}
          aria-label={activeSession?.busy ? "Stop run" : "Send prompt"}
          onClick={() => {
            if (activeSession?.busy) {
              onAbort();
              return;
            }

            submitPrompt();
          }}
        >
          {activeSession?.busy ? (
            <span
              aria-hidden="true"
					className="h-3 w-3 rounded-[2px] border-2 border-white"
            />
          ) : (
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
					className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M10 3.5V16.5" strokeLinecap="round" strokeLinejoin="round" />
              <path
                d="M5 8.5L10 3.5L15 8.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
});
