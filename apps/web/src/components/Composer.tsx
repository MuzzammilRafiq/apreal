import type { FormEvent, KeyboardEvent, RefObject } from "react";
import type { SessionSummary } from "../chatTypes";

type ComposerProps = {
	connected: boolean;
	activeSession: SessionSummary | null;
	activeSessionId: string | null;
	canSend: boolean;
	prompt: string;
	promptInputRef: RefObject<HTMLTextAreaElement | null>;
	onPromptChange: (value: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
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
	onSubmit,
	onKeyDown,
	onAbort,
}: ComposerProps) {
	return (
		<form id="composer" className="border-t border-line bg-chat-overlay px-8 pt-5.5 pb-7.5 max-[860px]:px-5" onSubmit={onSubmit}>
			<div className="border border-line-strong bg-surface-strong">
				<label className="sr-only" htmlFor="prompt-input">
					Message Pi
				</label>
				<textarea
					ref={promptInputRef}
					id="prompt-input"
					name="prompt"
					rows={3}
					value={prompt}
					onChange={(event) => onPromptChange(event.target.value)}
					onKeyDown={onKeyDown}
					disabled={!connected}
					placeholder={
						!connected
							? "Reconnecting to the local Pi server..."
							: activeSessionId
								? "Continue this session with the next task, follow-up, or code request"
								: "Describe what you want Pi to inspect, fix, or build"
						}
					className="min-h-27.5 w-full resize-y border-none bg-transparent px-5.5 pt-5 pb-4 text-base leading-[1.75] text-ink outline-none placeholder:text-faint focus-visible:outline-none max-[520px]:min-h-32.5"
				/>
				<div className="flex items-center justify-between gap-5 px-5.5 pr-4.5 pb-4.5 max-[720px]:flex-col max-[720px]:items-stretch">
					<p className="text-[0.82rem] leading-[1.6] text-muted">Enter to send. Shift + Enter for a new line.</p>
					<div className="flex items-center gap-2.5 max-[720px]:justify-between max-[520px]:flex-col max-[520px]:items-stretch">
						<button
							type="button"
							id="abort-button"
							className="border border-line bg-transparent px-4 py-2.75 text-[0.84rem] font-medium text-muted transition duration-150 hover:border-line-strong hover:bg-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-[0.34]"
							disabled={!connected || !activeSession || !activeSession.busy}
							onClick={onAbort}
						>
							Stop run
						</button>
						<button
							type="submit"
							id="send-button"
							className="border border-transparent bg-ink px-4 py-2.75 text-[0.84rem] font-medium text-sidebar-ink transition duration-150 hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-[0.34]"
							disabled={!canSend}
						>
							Send prompt
						</button>
					</div>
				</div>
			</div>
		</form>
	);
}
