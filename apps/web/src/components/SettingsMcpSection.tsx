import type { FormEvent } from "react";
import type { McpServerConfig, McpServerTransport } from "@apreal/shared";
import {
  MCP_TRANSPORT_OPTIONS,
  getMcpRuntimeLabel,
  getMcpRuntimeTone,
  StatusPill,
} from "./settings-helpers";
import { Button } from "./ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

type SettingsMcpSectionProps = {
  activeSection: string;
  mcpServers: McpServerConfig[];
  mcpServersError: string | null;
  isLoadingMcpServers: boolean;
  onRefreshMcpServers: () => void;
  enabledMcpServerCount: number;
  readyMcpServerCount: number;
  mcpToolCount: number;
  mcpFormMessage: string | null;
  mcpFormError: string | null;
  handleSubmitMcpServer: (event: FormEvent<HTMLFormElement>) => void;
  mcpEditingServerId: string | null;
  resetMcpForm: () => void;
  setMcpFormError: (message: string | null) => void;
  setMcpFormMessage: (message: string | null) => void;
  mcpName: string;
  setMcpName: (value: string) => void;
  mcpTransport: McpServerTransport;
  setMcpTransport: (value: McpServerTransport) => void;
  mcpEnabled: boolean;
  setMcpEnabled: (value: boolean) => void;
  mcpCommand: string;
  setMcpCommand: (value: string) => void;
  mcpArgs: string;
  setMcpArgs: (value: string) => void;
  mcpUrl: string;
  setMcpUrl: (value: string) => void;
  mcpEnv: string;
  setMcpEnv: (value: string) => void;
  mcpHeaders: string;
  setMcpHeaders: (value: string) => void;
  mcpActionServerId: string | null;
  handleEditMcpServer: (server: McpServerConfig) => void;
  handleToggleMcpServer: (server: McpServerConfig) => void;
  handleDeleteSelectedMcpServer: (serverId: string) => void;
};

const fieldInputClassName =
  "rounded border-black/10 bg-white text-[#171717] placeholder:text-slate-500 focus-visible:border-black/30 focus-visible:ring-black/10";

const fieldTextareaClassName =
  "min-h-24 rounded border-black/10 bg-white text-[#171717] placeholder:text-slate-500 focus-visible:border-black/30 focus-visible:ring-black/10";

function getTransportDescription(transport: McpServerTransport): string {
  return MCP_TRANSPORT_OPTIONS.find((option) => option.value === transport)?.description ?? "";
}

export function SettingsMcpSection({
  activeSection,
  mcpServers,
  mcpServersError,
  isLoadingMcpServers,
  onRefreshMcpServers,
  enabledMcpServerCount,
  readyMcpServerCount,
  mcpToolCount,
  mcpFormMessage,
  mcpFormError,
  handleSubmitMcpServer,
  mcpEditingServerId,
  resetMcpForm,
  setMcpFormError,
  setMcpFormMessage,
  mcpName,
  setMcpName,
  mcpTransport,
  setMcpTransport,
  mcpEnabled,
  setMcpEnabled,
  mcpCommand,
  setMcpCommand,
  mcpArgs,
  setMcpArgs,
  mcpUrl,
  setMcpUrl,
  mcpEnv,
  setMcpEnv,
  mcpHeaders,
  setMcpHeaders,
  mcpActionServerId,
  handleEditMcpServer,
  handleToggleMcpServer,
  handleDeleteSelectedMcpServer,
}: SettingsMcpSectionProps) {
  if (activeSection !== "mcp") {
    return null;
  }

  const isFormBusy = mcpActionServerId === (mcpEditingServerId ?? "new");

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill
          label={`${enabledMcpServerCount}/${mcpServers.length} active`}
          tone={enabledMcpServerCount > 0 ? "success" : "neutral"}
        />
        <StatusPill
          label={`${readyMcpServerCount} ready`}
          tone={readyMcpServerCount > 0 ? "success" : "neutral"}
        />
        <StatusPill
          label={`${mcpToolCount} tools`}
          tone={mcpToolCount > 0 ? "success" : "neutral"}
        />
      </div>

      {mcpServersError ? (
        <p className="ui-feedback mt-3 rounded px-3 py-2.5 text-[0.82rem] leading-normal font-medium">
          {mcpServersError}
        </p>
      ) : null}
      {mcpFormMessage ? (
        <p className="ui-feedback-soft mt-3 rounded px-3 py-2.5 text-[0.82rem] leading-normal font-medium">
          {mcpFormMessage}
        </p>
      ) : null}
      {mcpFormError ? (
        <p className="ui-feedback mt-3 rounded px-3 py-2.5 text-[0.82rem] leading-normal font-medium">
          {mcpFormError}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 min-[980px]:grid-cols-[minmax(22rem,0.88fr)_minmax(0,1.12fr)]">
        <form className="rounded border border-black/10 bg-white p-4 shadow-[0_12px_36px_rgba(15,23,42,0.05)]" onSubmit={handleSubmitMcpServer}>
          <FieldSet>
            <div className="flex items-start justify-between gap-3">
              <div>
                <FieldLegend>
                  {mcpEditingServerId ? "Edit MCP server" : "Add MCP server"}
                </FieldLegend>
                <FieldDescription>
                  Configure how the app should launch or connect to this MCP server.
                </FieldDescription>
              </div>
              {mcpEditingServerId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ui-settings-action-button rounded"
                  onClick={() => {
                    resetMcpForm();
                    setMcpFormError(null);
                    setMcpFormMessage(null);
                  }}
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="mcp-name">Display name</FieldLabel>
                <Input
                  id="mcp-name"
                  type="text"
                  value={mcpName}
                  onChange={(event) => setMcpName(event.target.value)}
                  placeholder="filesystem"
                  className={fieldInputClassName}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldDescription>
                  Use a short name that makes this server easy to recognize later.
                </FieldDescription>
              </Field>

              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="mcp-transport">Transport</FieldLabel>
                  <select
                    id="mcp-transport"
                    value={mcpTransport}
                    onChange={(event) => setMcpTransport(event.target.value as McpServerTransport)}
                    className="h-8 w-full rounded border border-black/10 bg-white px-2.5 py-1 text-sm text-[#171717] outline-none transition-colors focus-visible:border-black/30 focus-visible:ring-3 focus-visible:ring-black/10"
                  >
                    {MCP_TRANSPORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <FieldDescription>{getTransportDescription(mcpTransport)}</FieldDescription>
                </FieldContent>

                <Field orientation="horizontal" className="rounded border border-black/10 bg-slate-50 px-3 py-2">
                  <input
                    id="mcp-enabled"
                    type="checkbox"
                    checked={mcpEnabled}
                    onChange={(event) => setMcpEnabled(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="mcp-enabled">Enabled</FieldLabel>
                    <FieldDescription>Allow this server to start and expose tools.</FieldDescription>
                  </FieldContent>
                </Field>
              </Field>

              {mcpTransport === "stdio" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="mcp-command">Command</FieldLabel>
                    <Input
                      id="mcp-command"
                      type="text"
                      value={mcpCommand}
                      onChange={(event) => setMcpCommand(event.target.value)}
                      placeholder="npx -y @modelcontextprotocol/server-filesystem"
                      className={fieldInputClassName}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <FieldDescription>
                      The executable or package runner command used to launch the local MCP server.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="mcp-args">Arguments</FieldLabel>
                    <Textarea
                      id="mcp-args"
                      value={mcpArgs}
                      onChange={(event) => setMcpArgs(event.target.value)}
                      placeholder="One argument per line"
                      className={fieldTextareaClassName}
                      spellCheck={false}
                    />
                    <FieldDescription>
                      Put each command argument on its own line.
                    </FieldDescription>
                  </Field>
                </>
              ) : (
                <Field>
                  <FieldLabel htmlFor="mcp-url">Server URL</FieldLabel>
                  <Input
                    id="mcp-url"
                    type="url"
                    value={mcpUrl}
                    onChange={(event) => setMcpUrl(event.target.value)}
                    placeholder="https://example.com/mcp"
                    className={fieldInputClassName}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <FieldDescription>
                    The remote endpoint for the selected MCP transport.
                  </FieldDescription>
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="mcp-env">Environment variables</FieldLabel>
                <Textarea
                  id="mcp-env"
                  value={mcpEnv}
                  onChange={(event) => setMcpEnv(event.target.value)}
                  placeholder="KEY=value"
                  className={fieldTextareaClassName}
                  spellCheck={false}
                />
                <FieldDescription>
                  Add one variable per line using KEY=value.
                </FieldDescription>
              </Field>

              {mcpTransport !== "stdio" ? (
                <Field>
                  <FieldLabel htmlFor="mcp-headers">Request headers</FieldLabel>
                  <Textarea
                    id="mcp-headers"
                    value={mcpHeaders}
                    onChange={(event) => setMcpHeaders(event.target.value)}
                    placeholder="Authorization=Bearer ..."
                    className={fieldTextareaClassName}
                    spellCheck={false}
                  />
                  <FieldDescription>
                    Add one HTTP header per line using Header-Name=value.
                  </FieldDescription>
                </Field>
              ) : null}

              {mcpFormError ? <FieldError>{mcpFormError}</FieldError> : null}

              <Button
                type="submit"
                className="ui-settings-action-button w-full rounded"
                disabled={mcpActionServerId !== null}
              >
                {isFormBusy
                  ? mcpEditingServerId
                    ? "Saving..."
                    : "Creating..."
                  : mcpEditingServerId
                    ? "Save MCP Server"
                    : "Create MCP Server"}
              </Button>
            </FieldGroup>
          </FieldSet>
        </form>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">
                Servers
              </p>
              <h3 className="mt-1 text-[1rem] font-bold text-slate-950">Configured MCP servers</h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ui-settings-action-button rounded"
              onClick={onRefreshMcpServers}
              disabled={isLoadingMcpServers}
            >
              {isLoadingMcpServers ? "Syncing..." : "Sync"}
            </Button>
          </div>

          {mcpServers.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 bg-white py-5 text-center text-sm font-semibold text-slate-500">
              No MCP servers configured yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {mcpServers.map((server) => {
                const isBusy = mcpActionServerId === server.id;
                return (
                  <li
                    key={server.id}
                    className={`rounded border px-3 py-3 ${server.enabled ? "border-(--color-brand-line-strong) bg-white" : "border-(--color-brand-line) bg-[rgba(255,255,255,0.72)]"}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[0.94rem] font-bold text-slate-900">
                            {server.name}
                          </p>
                          <span
                            className={`rounded border px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-widest ${server.enabled ? "border-(--color-brand) bg-brand text-white" : "border-(--color-brand-line-strong) bg-white text-slate-500"}`}
                          >
                            {server.enabled ? "Enabled" : "Disabled"}
                          </span>
                          <span className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-widest text-slate-500">
                            {server.transport}
                          </span>
                          <StatusPill
                            label={getMcpRuntimeLabel(server)}
                            tone={getMcpRuntimeTone(server)}
                          />
                        </div>
                        <p className="mt-1.5 break-all font-mono text-[0.72rem] text-slate-500">
                          {server.transport === "stdio"
                            ? `${server.command ?? "No command"}${server.args.length > 0 ? ` ${server.args.join(" ")}` : ""}`
                            : (server.url ?? "No URL")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ui-settings-action-button rounded"
                          onClick={() => handleEditMcpServer(server)}
                          disabled={mcpActionServerId !== null}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ui-settings-action-button rounded"
                          onClick={() => {
                            void handleToggleMcpServer(server);
                          }}
                          disabled={mcpActionServerId !== null}
                        >
                          {isBusy ? "Saving..." : server.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ui-settings-danger-button rounded"
                          onClick={() => {
                            void handleDeleteSelectedMcpServer(server.id);
                          }}
                          disabled={mcpActionServerId !== null}
                        >
                          {isBusy ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2.5 grid gap-2 text-[0.76rem] text-slate-600 min-[720px]:grid-cols-2">
                      <div>
                        <FieldTitle className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-400">
                          Runtime
                        </FieldTitle>
                        <p className="mt-1">
                          {server.runtime?.toolCount ?? 0} tool
                          {(server.runtime?.toolCount ?? 0) === 1 ? "" : "s"} discovered
                        </p>
                        {server.runtime?.lastError ? (
                          <p className="mt-1 text-slate-700">
                            {server.runtime.lastError}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <FieldTitle className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-400">
                          Environment
                        </FieldTitle>
                        <p className="mt-1">
                          {Object.keys(server.env).length} variable
                          {Object.keys(server.env).length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div>
                        <FieldTitle className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-slate-400">
                          Headers
                        </FieldTitle>
                        <p className="mt-1">
                          {Object.keys(server.headers).length} header
                          {Object.keys(server.headers).length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
