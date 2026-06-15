import type { FormEvent, ReactNode } from "react";
import type { LocalWebAdminStatus } from "@apreal/shared";
import { authClient } from "../auth/auth-client";
import { BUILD_VERSION } from "../generated/build-version";
import { AccountAuthButton } from "./AccountAuthButton";

type SettingsAccountSectionProps = {
  active: boolean;
  adminStatus: LocalWebAdminStatus | null;
  statusError: string | null;
  connectionError: string | null;
  connected: boolean;
  handleAppendSystemPromptSubmit: (event: FormEvent<HTMLFormElement>) => void;
  appendSystemPromptDraft: string;
  setAppendSystemPromptDraft: (value: string) => void;
  isSavingAppendPrompt: boolean;
  appendPromptSubmissionMessage: string | null;
  appendPromptSubmissionError: string | null;
  onDeleteAllSessions: () => void;
  deletingAllSessions: boolean;
  deleteSessionsMessage: string | null;
  deleteSessionsError: string | null;
  modelControl?: ReactNode;
};

export function SettingsAccountSection({
  active,
  adminStatus,
  statusError,
  connectionError,
  connected,
  handleAppendSystemPromptSubmit,
  appendSystemPromptDraft,
  setAppendSystemPromptDraft,
  isSavingAppendPrompt,
  appendPromptSubmissionMessage,
  appendPromptSubmissionError,
  onDeleteAllSessions,
  deletingAllSessions,
  deleteSessionsMessage,
  deleteSessionsError,
  modelControl,
}: SettingsAccountSectionProps) {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;
  const userImage =
    typeof (user as { image?: unknown } | undefined)?.image === "string"
      ? ((user as { image?: string | null }).image ?? null)
      : null;
  const userLabel = user?.name || user?.email || "Signed in";
  const userInitial = userLabel.trim().charAt(0).toUpperCase() || "A";

  if (!active) {
    return null;
  }
  const sessionLabel =
    typeof adminStatus?.sessions === "number"
      ? `${adminStatus.sessions} session${adminStatus.sessions === 1 ? "" : "s"}`
      : "Unavailable";

  return (
    <div className="space-y-4 ">
      <section className="p-4 ">
        <div className="flex flex-col gap-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-[linear-gradient(180deg,#ffffff,var(--color-brand-soft))] text-lg font-bold text-(--color-brand-ink) shadow-[0_10px_24px_var(--color-brand-shadow)]">
              {userImage ? (
                <img
                  src={userImage}
                  alt={
                    user?.name
                      ? `${user.name} profile`
                      : "Google account profile"
                  }
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span>{userInitial}</span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
                {isPending
                  ? "Checking account..."
                  : user
                    ? userLabel
                    : "Not signed in"}
              </h2>
              {user?.email ? (
                <p className="mt-1 text-sm font-medium text-slate-600">
                  {user.email}
                </p>
              ) : null}
            </div>
          </div>
          <div className="w-full min-[760px]:w-56">
            <AccountAuthButton tone="light" />
          </div>
        </div>

        <div className="p-2 flex min-w-0 items-baseline justify-between gap-4">
          <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.12em] text-slate-500">
            Sessions
          </p>
          <p className="text-right text-[0.95rem] font-semibold text-slate-900">
            {sessionLabel}
          </p>
        </div>

        {statusError ? (
          <p className="ui-feedback mt-4 px-3 py-2.5 text-[0.84rem] font-medium leading-normal">
            {statusError}
          </p>
        ) : null}
        {connectionError ? (
          <p className="ui-feedback-soft mt-3 px-3 py-2.5 text-[0.84rem] font-medium leading-normal">
            {connectionError}
          </p>
        ) : null}
      </section>

      {modelControl}

      <form className="pb-2 px-2 " onSubmit={handleAppendSystemPromptSubmit}>
        <label className="mt-4 block">
          <textarea
            value={appendSystemPromptDraft}
            onChange={(event) => {
              setAppendSystemPromptDraft(event.target.value);
            }}
            rows={10}
            placeholder={"Append instructions to Apreal's system prompt"}
            className="mt-2 min-h-56 w-full resize-y  px-2 py-3 text-[0.95rem] leading-[1.6] border rounded"
            spellCheck={false}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3 ">
          <button
            type="submit"
            className="bg-black text-white py-2 px-6 cursor-pointer rounded"
            disabled={
              isSavingAppendPrompt ||
              !adminStatus ||
              appendSystemPromptDraft === (adminStatus.appendSystemPrompt ?? "")
            }
          >
            {isSavingAppendPrompt ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="bg-slate-100 px-6 py-2 cursor-pointer rounded"
            disabled={
              isSavingAppendPrompt ||
              !adminStatus ||
              appendSystemPromptDraft.length === 0
            }
            onClick={() => {
              setAppendSystemPromptDraft("");
            }}
          >
            Clear
          </button>
        </div>

        {appendPromptSubmissionMessage ? (
          <p className="ui-feedback-soft mt-3 px-3 py-2.5 text-[0.84rem] leading-normal font-medium">
            {appendPromptSubmissionMessage}
          </p>
        ) : null}
        {appendPromptSubmissionError ? (
          <p className="ui-feedback mt-3 px-3 py-2.5 text-[0.84rem] leading-normal font-medium">
            {appendPromptSubmissionError}
          </p>
        ) : null}
      </form>

      <section className="pt-10">
        <h2 className="m-1 text-red-700">
          Delete saved chats This removes saved chat sessions from the server
          and clears them from connected browsers.
        </h2>
        <button
          type="button"
          className="bg-red-700 text-white px-6 py-2 cursor-pointer rounded"
          onClick={onDeleteAllSessions}
          disabled={deletingAllSessions}
        >
          {deletingAllSessions ? "Deleting chats..." : "Delete all chats"}
        </button>
        {deleteSessionsMessage ? (
          <p className="ui-feedback-soft mt-3 px-3 py-2.5 text-[0.84rem] leading-normal font-medium">
            {deleteSessionsMessage}
          </p>
        ) : null}
        {deleteSessionsError ? (
          <p className="ui-feedback mt-3 px-3 py-2.5 text-[0.84rem] leading-normal font-medium">
            {deleteSessionsError}
          </p>
        ) : null}
        <p className="mt-3 text-[0.68rem] leading-normal text-slate-400">
          {BUILD_VERSION}
        </p>
      </section>
    </div>
  );
}
