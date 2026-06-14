import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ProvidersResponse } from "@apreal/shared";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import type { SessionSummary } from "../chatTypes";
import { buildSearchableModels, normalizeSearchValue } from "./settings-helpers";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
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

function formatCurrentModelLabel(providers: ProvidersResponse | null, activeSession: SessionSummary | null): string {
	const currentDefaultModel = buildSearchableModels(providers).find((model) => model.isDefault) ?? null;
	return currentDefaultModel?.label ?? formatModelLabel(activeSession?.model ?? null) ?? "Choose model";
}

type ComposerProps = {
	connected: boolean;
	serverReady: boolean;
	streamRequested: boolean;
	blockedReason: string | null;
	connectionLabel: string;
	activeSession: SessionSummary | null;
	activeSessionId: string | null;
	providers: ProvidersResponse | null;
	providersError: string | null;
	aborting: boolean;
	promptInputRef: RefObject<HTMLTextAreaElement | null>;
	onSetDefaultModel: (provider: string, modelId: string) => Promise<void>;
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
	providers,
	providersError,
	aborting,
	promptInputRef,
	onSetDefaultModel,
	onSend,
	onAbort,
}: ComposerProps) {
	const [prompt, setPrompt] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [modelQuery, setModelQuery] = useState("");
	const [savingModelKey, setSavingModelKey] = useState<string | null>(null);
	const [modelUpdateError, setModelUpdateError] = useState<string | null>(null);
	const pickerRef = useRef<HTMLDivElement | null>(null);
	const canSend = serverReady && !blockedReason && !activeSession?.busy && prompt.trim().length > 0;
	const searchableModels = useMemo(() => buildSearchableModels(providers), [providers]);
	const currentDefaultModel = useMemo(
		() => searchableModels.find((model) => model.isDefault) ?? null,
		[searchableModels],
	);
	const currentModelLabel = useMemo(
		() => formatCurrentModelLabel(providers, activeSession),
		[providers, activeSession],
	);
	const normalizedModelQuery = normalizeSearchValue(modelQuery);
	const visibleModels = useMemo(() => {
		if (!normalizedModelQuery) {
			return searchableModels;
		}

		return searchableModels.filter((model) => model.searchText.includes(normalizedModelQuery));
	}, [normalizedModelQuery, searchableModels]);

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

	useEffect(() => {
		if (!modelPickerOpen) {
			return;
		}

		function handlePointerDown(event: MouseEvent) {
			if (!pickerRef.current?.contains(event.target as Node)) {
				setModelPickerOpen(false);
			}
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setModelPickerOpen(false);
			}
		}

		window.addEventListener("mousedown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [modelPickerOpen]);

	async function handleSelectModel(providerId: string, modelId: string) {
		const key = `${providerId}:${modelId}`;
		setSavingModelKey(key);
		setModelUpdateError(null);

		try {
			await onSetDefaultModel(providerId, modelId);
			setModelPickerOpen(false);
			setModelQuery("");
		} catch (error) {
			setModelUpdateError(error instanceof Error ? error.message : "Failed to update the model.");
		} finally {
			setSavingModelKey(null);
		}
	}

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
				"pointer-events-auto mx-auto w-full max-w-216 rounded-xl bg-white transition-colors duration-150 **:data-[slot=input-group]:h-auto **:data-[slot=input-group]:rounded-[1.15rem] **:data-[slot=input-group]:border **:data-[slot=input-group]:bg-white [&_[data-slot=input-group]:has(:disabled)]:opacity-100 **:data-[slot=input-group-addon]:opacity-100",
				modelPickerOpen
					? "**:data-[slot=input-group]:overflow-visible"
					: "**:data-[slot=input-group]:overflow-hidden",
				isFocused
					? "**:data-[slot=input-group]:border-black/18"
					: "**:data-[slot=input-group]:border-black/8",
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
					className="min-h-18 max-h-[calc(11.55em+1rem)] px-4 py-3 text-[0.98rem] leading-[1.6] text-slate-900 placeholder:text-slate-400"
				/>
			</PromptInputBody>
			<PromptInputFooter className="px-3 pb-3 pt-0 min-[861px]:px-4">
				<PromptInputTools className="min-w-0 flex-1">
					<div ref={pickerRef} className="relative max-w-full">
						<button
							type="button"
							className="inline-flex max-w-full items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-left text-[0.82rem] font-normal text-black transition-colors hover:border-black/20 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed"
							onClick={() => {
								setModelUpdateError(null);
								setModelPickerOpen((open) => !open);
							}}
							disabled={savingModelKey !== null}
							aria-haspopup="dialog"
							aria-expanded={modelPickerOpen}
							title={currentDefaultModel ? `${currentDefaultModel.providerLabel} · ${currentDefaultModel.modelId}` : currentModelLabel}
						>
							<span className="truncate">{currentModelLabel}</span>
							{savingModelKey ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
						</button>

						{modelPickerOpen ? (
							<div className="absolute bottom-[calc(100%+0.6rem)] left-0 z-30 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
								<div className="border-b border-black/8 px-3 py-3">
									<p className="text-sm font-normal text-black">
										{searchableModels.length > 0
											? `${searchableModels.length} model${searchableModels.length === 1 ? "" : "s"} available`
											: "Model picker"}
									</p>
									<p className="mt-1 text-[0.82rem] font-normal text-black">
										Current: {currentModelLabel}
									</p>
									{modelUpdateError ? (
										<p className="mt-2 text-[0.78rem] font-normal text-black">{modelUpdateError}</p>
									) : providersError ? (
										<p className="mt-2 text-[0.78rem] font-normal text-black">{providersError}</p>
									) : null}
								</div>
								<Command shouldFilter={false}>
									<CommandInput
										value={modelQuery}
										onValueChange={setModelQuery}
										placeholder="Search models or providers..."
									/>
									<CommandList>
										{providers === null ? (
											<div className="px-3 py-5 text-center text-sm font-normal text-black">Loading models...</div>
										) : searchableModels.length === 0 ? (
											<div className="px-3 py-5 text-center text-sm font-normal text-black">No models are available yet.</div>
										) : (
											<>
												<CommandEmpty>No models match that search.</CommandEmpty>
												<CommandGroup heading="Available models">
													{visibleModels.map((model) => {
														const isCurrent = model.isDefault;
														const isSaving = savingModelKey === model.key;
														return (
															<CommandItem
																key={model.key}
																value={`${model.label} ${model.providerLabel} ${model.modelId}`}
																onSelect={() => {
																	if (!isCurrent && !isSaving && savingModelKey === null) {
																		void handleSelectModel(model.providerId, model.modelId);
																	}
																}}
																disabled={isSaving || savingModelKey !== null}
															>
																<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
																	{isSaving ? (
																		<LoaderCircle className="h-3.5 w-3.5 animate-spin text-black" />
																	) : isCurrent ? (
																		<Check className="h-3.5 w-3.5 text-black" />
																	) : (
																		<span className="h-2 w-2 rounded-full bg-black/70" />
																	)}
																</span>
																<span className="min-w-0 flex-1">
																	<span className="block truncate text-sm font-normal text-black">{model.label}</span>
																	<span className="mt-0.5 block break-all text-[0.74rem] font-mono font-normal text-black">
																		{model.providerLabel} · {model.modelId}
																	</span>
																</span>
															</CommandItem>
														);
													})}
												</CommandGroup>
											</>
										)}
									</CommandList>
								</Command>
							</div>
						) : null}
					</div>
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
