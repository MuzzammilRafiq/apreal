import type { FormEvent } from "react";
import type { LocalWebAdminStatus } from "@apreal/shared";
import { authClient } from "../auth/auth-client";
import { AccountAuthButton } from "./AccountAuthButton";

declare const __APREAL_WEB_TARGET__: "local" | "remote";

type SettingsAccountSectionProps = {
	active: boolean;
	adminStatus: LocalWebAdminStatus | null;
	statusError: string | null;
	connectionError: string | null;
	connected: boolean;
	handleAppendSystemPromptSubmit: (event: FormEvent<HTMLFormElement>) => void;
	appendSystemPromptDraft: string;
	setAppendSystemPromptDraft: (value: string) => void;
	setAppendSystemPromptDirty: (dirty: boolean) => void;
	isSavingAppendPrompt: boolean;
	appendPromptSubmissionMessage: string | null;
	appendPromptSubmissionError: string | null;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-black/8 py-3 last:border-b-0">
			<p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
			<p className="text-right text-[0.95rem] font-semibold text-slate-900">{value}</p>
		</div>
	);
}

export function SettingsAccountSection({
	active,
	adminStatus,
	statusError,
	connectionError,
	connected,
	handleAppendSystemPromptSubmit,
	appendSystemPromptDraft,
	setAppendSystemPromptDraft,
	setAppendSystemPromptDirty,
	isSavingAppendPrompt,
	appendPromptSubmissionMessage,
	appendPromptSubmissionError,
}: SettingsAccountSectionProps) {
	const { data: session, isPending } = authClient.useSession();
	const user = session?.user;
	const userImage = typeof (user as { image?: unknown } | undefined)?.image === "string"
		? (user as { image?: string | null }).image ?? null
		: null;
	const userLabel = user?.name || user?.email || "Signed in";
	const userInitial = userLabel.trim().charAt(0).toUpperCase() || "A";

	if (!active) {
		return null;
	}

	const clientLabel = __APREAL_WEB_TARGET__ === "remote"
		? (connected ? "Relay available" : "Relay unavailable")
		: (connected ? "Available" : "Unavailable");
	const sessionLabel = typeof adminStatus?.sessions === "number"
		? `${adminStatus.sessions} session${adminStatus.sessions === 1 ? "" : "s"}`
		: "Unavailable";

	return (
		<div className="space-y-4">
			<section className="bg-white px-1 py-1">
				<div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
					<div className="flex min-w-0 items-start gap-4">
						<div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[1.4rem] bg-[linear-gradient(180deg,#f7f7f7,#ececec)] text-lg font-bold text-slate-700 shadow-[0_10px_24px_rgba(0,0,0,0.06)]">
							{userImage ? (
								<img
									src={userImage}
									alt={user?.name ? `${user.name} profile` : "Google account profile"}
									className="h-full w-full object-cover"
									referrerPolicy="no-referrer"
								/>
							) : (
								<span>{userInitial}</span>
							)}
						</div>
						<div className="min-w-0">
							<p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
								Google account
							</p>
							<h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
								{isPending ? "Checking account..." : user ? userLabel : "Not signed in"}
							</h2>
							{user?.email ? <p className="mt-1 text-sm font-medium text-slate-600">{user.email}</p> : null}
							<p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
								This account authorizes the {__APREAL_WEB_TARGET__ === "remote" ? "remote relay session" : "local browser session"}.
							</p>
						</div>
					</div>
					<div className="w-full min-[760px]:w-56">
						<AccountAuthButton showSignedInDetails={false} tone="light" />
					</div>
				</div>

				<div className="mt-6 border-t border-black/8">
					<SummaryRow label="Client connection" value={clientLabel} />
					<SummaryRow label="Sessions" value={sessionLabel} />
				</div>

				{statusError ? (
					<p className="mt-4 border-l-2 border-black/25 bg-black/[0.03] px-3 py-2.5 text-[0.84rem] font-medium leading-[1.5] text-slate-800">
						{statusError}
					</p>
				) : null}
				{connectionError ? (
					<p className="mt-3 border-l border-black/12 px-3 py-2.5 text-[0.84rem] font-medium leading-[1.5] text-slate-700">
						{connectionError}
					</p>
				) : null}
			</section>

			<form className="border-t border-black/8 pt-5" onSubmit={handleAppendSystemPromptSubmit}>
				<p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">Prompt Layering</p>
				<h2 className="mt-1 text-base font-bold text-slate-900">Append instructions to Pi's system prompt</h2>
				<p className="mt-2 text-[0.88rem] leading-[1.6] text-slate-600">
					Saved to <span className="font-mono text-[0.8rem] text-slate-800">{adminStatus?.appendSystemPromptPath ?? "APPEND_SYSTEM.md"}</span>. Pi appends this after its base prompt for new or reloaded sessions.
				</p>

				<label className="mt-4 block">
					<span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#64748b]">Additional system instructions</span>
					<textarea
						value={appendSystemPromptDraft}
						onChange={(event) => {
							setAppendSystemPromptDraft(event.target.value);
							setAppendSystemPromptDirty(true);
						}}
						rows={10}
						placeholder={"Example:\n- Always explain tradeoffs before editing infra code.\n- Prefer existing project patterns over introducing new abstractions."}
						className="mt-2 min-h-[14rem] w-full resize-y border-b border-black/14 bg-black/[0.025] px-0 py-3 text-[0.95rem] leading-[1.6] text-[#171717] placeholder:text-slate-400 outline-none transition focus:border-black focus:bg-transparent"
						spellCheck={false}
					/>
				</label>

				<div className="mt-4 flex flex-wrap items-center gap-3">
					<button
						type="submit"
						className="inline-flex items-center justify-center border border-black bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
						disabled={isSavingAppendPrompt || !adminStatus || appendSystemPromptDraft === (adminStatus.appendSystemPrompt ?? "")}
					>
						{isSavingAppendPrompt ? "Saving prompt..." : "Save appended prompt"}
					</button>
					<button
						type="button"
						className="inline-flex items-center justify-center border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
						disabled={isSavingAppendPrompt || !adminStatus || appendSystemPromptDraft.length === 0}
						onClick={() => {
							setAppendSystemPromptDraft("");
							setAppendSystemPromptDirty(true);
						}}
					>
						Clear editor
					</button>
				</div>

				{appendPromptSubmissionMessage ? (
					<p className="mt-3 border-l border-black/12 px-3 py-2.5 text-[0.84rem] leading-[1.5] text-slate-700 font-medium">
						{appendPromptSubmissionMessage}
					</p>
				) : null}
				{appendPromptSubmissionError ? (
					<p className="mt-3 border-l-2 border-black/25 bg-black/[0.03] px-3 py-2.5 text-[0.84rem] leading-[1.5] text-slate-800 font-medium">
						{appendPromptSubmissionError}
					</p>
				) : null}
			</form>
		</div>
	);
}
