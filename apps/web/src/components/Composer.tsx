import { useLayoutEffect, type RefObject } from "react";
import type { SessionSummary } from "../chatTypes";

type ComposerProps = {
  connected: boolean;
  activeSession: SessionSummary | null;
  activeSessionId: string | null;
  canSend: boolean;
  prompt: string;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
};

export function Composer({
  connected,
  activeSession,
  activeSessionId,
  canSend,
  prompt,
  promptInputRef,
  onPromptChange,
  onSend,
  onAbort,
}: ComposerProps) {
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

  return (
    <div className="pointer-events-auto mx-auto flex w-full max-w-310 items-end gap-3  border border-line/70 bg-chat-overlay px-3 py-3 shadow-[0_22px_60px_rgba(23,21,18,0.14)] backdrop-blur-xl">
      <textarea
        ref={promptInputRef}
        id="prompt-input"
        name="prompt"
        rows={1}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        disabled={!connected}
        onInput={resizePromptInput}
        placeholder={
          !connected
            ? "Reconnecting to the local Pi server..."
            : activeSessionId
              ? "Continue this session with the next task, follow-up, or code request"
              : "Describe what you want Pi to inspect, fix, or build"
        }
        className="min-h-[calc(1.75em+1.5rem)] max-h-[calc((1.75em*7)+1.5rem)] flex-1 resize-none overflow-hidden border-none bg-transparent px-3 py-3 text-[1.05rem] leading-[1.75] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
      />
      <button
        type="button"
        id={activeSession?.busy ? "abort-button" : "send-button"}
        className="flex h-13 w-13 shrink-0 items-center justify-center  border border-transparent bg-ink text-sidebar-ink shadow-[0_10px_24px_rgba(23,21,18,0.18)] transition duration-150 hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-[0.34]"
        disabled={!connected || (!canSend && !activeSession?.busy)}
        aria-label={activeSession?.busy ? "Stop run" : "Send prompt"}
        onClick={() => {
          if (activeSession?.busy) {
            onAbort();
            return;
          }

          onSend();
        }}
      >
        {activeSession?.busy ? (
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-sm border-2 border-current"
          />
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
          >
            <path d="M10 3.5V16.5" strokeLinecap="round" />
            <path
              d="M5 8.5L10 3.5L15 8.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
