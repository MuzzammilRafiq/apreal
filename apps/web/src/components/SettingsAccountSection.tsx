import type { FormEvent, ReactNode } from "react";
import type { LocalWebAdminStatus } from "@apreal/shared";
import { AlertTriangle, LoaderCircle, RotateCcw, Save, Trash2 } from "lucide-react";
import { authClient } from "../auth/auth-client";
import { BUILD_VERSION } from "../generated/build-version";
import { AccountAuthButton } from "./AccountAuthButton";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldSet, FieldGroup, FieldLegend } from "./ui/field";
import { Textarea } from "./ui/textarea";

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

const cardClassName =
  "rounded-lg border border-black/10 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.05)]";

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
  const isSignedIn = Boolean(user);

  if (!active) {
    return null;
  }

  const sessionLabel =
    typeof adminStatus?.sessions === "number"
      ? `${adminStatus.sessions} session${adminStatus.sessions === 1 ? "" : "s"}`
      : "Unavailable";

  const appendBaseline = adminStatus?.appendSystemPrompt ?? "";
  const hasAppendChanges = appendSystemPromptDraft !== appendBaseline;
  const canEditAppend = Boolean(adminStatus) && !isSavingAppendPrompt;

  return (
    <div className="space-y-5">
      {/* ===== Profile ===== */}
      <section className={cardClassName}>
        <div className="flex flex-col gap-5 p-5 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(180deg,#ffffff,var(--color-brand-soft))] text-xl font-bold text-(--color-brand-ink) shadow-[0_8px_24px_var(--color-brand-shadow)] ring-1 ring-black/10">
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
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-slate-950">
                  {isPending
                    ? "Checking account..."
                    : isSignedIn
                      ? userLabel
                      : "Not signed in"}
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded border border-black/10 bg-black/3 px-2 py-0.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.12em] text-slate-600">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isPending
                        ? "bg-slate-400"
                        : isSignedIn
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                    }`}
                    aria-hidden="true"
                  />
                  {isPending ? "Pending" : isSignedIn ? "Signed in" : "Signed out"}
                </span>
              </div>
              {user?.email ? (
                <p className="mt-1 truncate text-sm font-medium text-slate-600">
                  {user.email}
                </p>
              ) : null}
              {!isSignedIn && !isPending ? (
                <p className="mt-1 text-[0.82rem] leading-relaxed text-slate-500">
                  Sign in to sync your profile and authorize remote access.
                </p>
              ) : null}
            </div>
          </div>
          <div className="w-full min-[760px]:w-60 min-[760px]:shrink-0">
            <AccountAuthButton tone="light" />
          </div>
        </div>

        <dl className="grid grid-cols-2 divide-x divide-black/8 border-t border-black/8 bg-[rgba(245,245,245,0.5)]">
          <div className="px-5 py-3">
            <dt className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-400">
              Sessions
            </dt>
            <dd className="mt-1 text-[0.95rem] font-semibold text-slate-900">
              {sessionLabel}
            </dd>
          </div>
          <div className="px-5 py-3">
            <dt className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-400">
              Connection
            </dt>
            <dd className="mt-1 flex items-center gap-1.5 text-[0.95rem] font-semibold text-slate-900">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? "bg-emerald-500" : "bg-amber-500"
                }`}
                aria-hidden="true"
              />
              {connected ? "Connected" : "Offline"}
            </dd>
          </div>
        </dl>
      </section>

      {statusError ? (
        <p className="ui-feedback rounded px-3 py-2.5 text-[0.84rem] font-medium leading-normal">
          {statusError}
        </p>
      ) : null}
      {connectionError ? (
        <p className="ui-feedback-soft rounded px-3 py-2.5 text-[0.84rem] font-medium leading-normal">
          {connectionError}
        </p>
      ) : null}

      {modelControl}

      {/* ===== Custom instructions ===== */}
      <form
        className={`${cardClassName} p-5`}
        onSubmit={handleAppendSystemPromptSubmit}
      >
        <FieldSet className="gap-5">
          <FieldLegend>Custom instructions</FieldLegend>

          <FieldGroup>
            <Field>
              <Textarea
                value={appendSystemPromptDraft}
                onChange={(event) => {
                  setAppendSystemPromptDraft(event.target.value);
                }}
                rows={8}
                placeholder="e.g. Always respond in British English. Prefer concise answers and cite sources."
                className="min-h-40 resize-y text-[0.92rem] leading-[1.6]"
                spellCheck={false}
              />
              <FieldDescription>
                {hasAppendChanges
                  ? "Unsaved changes \u2014 save to apply to new chats."
                  : "Saved locally on this machine."}
              </FieldDescription>
            </Field>

            {appendPromptSubmissionError ? (
              <p className="ui-feedback rounded px-3 py-2.5 text-[0.82rem] font-medium leading-normal">
                {appendPromptSubmissionError}
              </p>
            ) : null}
            {appendPromptSubmissionMessage ? (
              <p className="ui-feedback-soft rounded px-3 py-2.5 text-[0.82rem] font-medium leading-normal">
                {appendPromptSubmissionMessage}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                className="ui-settings-action-button rounded"
                disabled={!canEditAppend || !hasAppendChanges}
              >
                {isSavingAppendPrompt ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                {isSavingAppendPrompt ? "Saving..." : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded"
                disabled={!canEditAppend || !hasAppendChanges}
                onClick={() => {
                  setAppendSystemPromptDraft(appendBaseline);
                }}
              >
                <RotateCcw />
                Revert
              </Button>
            </div>
          </FieldGroup>
        </FieldSet>
      </form>

      {/* ===== Danger zone ===== */}
      <section className="rounded-lg border border-red-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600 ring-1 ring-red-200">
            <AlertTriangle className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[0.98rem] font-bold text-slate-950">
              Delete saved chats
            </h3>
            <p className="mt-1 text-[0.84rem] leading-relaxed text-slate-600">
              Removes every saved chat session from this server and clears them
              from connected browsers. This cannot be undone.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Button
            type="button"
            className="ui-settings-danger-button rounded"
            onClick={onDeleteAllSessions}
            disabled={deletingAllSessions}
          >
            {deletingAllSessions ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            {deletingAllSessions ? "Deleting chats..." : "Delete all chats"}
          </Button>
        </div>

        {deleteSessionsMessage ? (
          <p className="ui-feedback-soft mt-3 rounded px-3 py-2.5 text-[0.82rem] font-medium leading-normal">
            {deleteSessionsMessage}
          </p>
        ) : null}
        {deleteSessionsError ? (
          <p className="ui-feedback mt-3 rounded px-3 py-2.5 text-[0.82rem] font-medium leading-normal">
            {deleteSessionsError}
          </p>
        ) : null}
      </section>

      {/* ===== Build version ===== */}
      <p className="px-1 pt-1 text-[0.68rem] leading-normal text-slate-400">
        {BUILD_VERSION.label}
        {BUILD_VERSION.shortCommitHash !== "unknown" ? (
          <>
            {" \u00b7 "}
            {BUILD_VERSION.commitUrl ? (
              <a
                href={BUILD_VERSION.commitUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-slate-500 underline underline-offset-2"
                title={BUILD_VERSION.commitHash}
              >
                {BUILD_VERSION.shortCommitHash}
              </a>
            ) : (
              <span
                className="font-mono text-slate-500"
                title={BUILD_VERSION.commitHash}
              >
                {BUILD_VERSION.shortCommitHash}
              </span>
            )}
          </>
        ) : null}
      </p>
    </div>
  );
}
