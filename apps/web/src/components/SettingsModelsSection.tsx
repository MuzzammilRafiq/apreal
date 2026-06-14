import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { StatusPill, type SearchableModel, type SearchableProvider } from "./settings-helpers";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";

type SettingsModelsSectionProps = {
  active: boolean;
  providers: { providers: unknown[] } | null;
  providersError: string | null;
  searchableModels: SearchableModel[];
  searchableProviders: SearchableProvider[];
  currentDefaultModel: SearchableModel | null;
  modelUpdateMessage: string | null;
  modelUpdateError: string | null;
  providerAuthError: string | null;
  savingModelKey: string | null;
  handleSelectModel: (providerId: string, modelId: string) => void;
  authActionProviderId: string | null;
  handleStartLogin: (providerId: string) => void;
  apiKeyEditorProviderId: string | null;
  setApiKeyEditorProviderId: (updater: (current: string | null) => string | null) => void;
  setProviderAuthError: (error: string | null) => void;
  apiKeyDrafts: Record<string, string>;
  setApiKeyDrafts: (updater: (previous: Record<string, string>) => Record<string, string>) => void;
  handleSaveApiKey: (providerId: string) => void;
};

function getProviderAuthLabel(provider: Pick<SearchableProvider, "authType">): string {
  return provider.authType === "oauth" ? "Subscription" : "API key";
}

function getProviderStatusLabel(provider: Pick<SearchableProvider, "loginState" | "models">): string {
  if (provider.loginState.status === "pending") {
    return "Login pending";
  }

  if (provider.loginState.status === "failed") {
    return "Login failed";
  }

  if (provider.models.length > 0) {
    return `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} indexed`;
  }

  return "No models indexed";
}

function getProviderAuthMessage(provider: Pick<SearchableProvider, "loginState" | "models">): string {
  if (provider.loginState.status === "pending") {
    return "Browser login is waiting for completion.";
  }

  if (provider.loginState.status === "failed") {
    return provider.loginState.error ?? "Provider login failed.";
  }

  if (provider.models.length > 0) {
    return "Ready for model selection.";
  }

  return "Configure this provider to index available models.";
}

function stopPickerButtonEvent(event: ReactMouseEvent | ReactPointerEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function SettingsModelsSection({
  active,
  providers,
  providersError,
  searchableModels,
  searchableProviders,
  currentDefaultModel,
  modelUpdateMessage,
  modelUpdateError,
  providerAuthError,
  savingModelKey,
  handleSelectModel,
  authActionProviderId,
  handleStartLogin,
  apiKeyEditorProviderId,
  setApiKeyEditorProviderId,
  setProviderAuthError,
  apiKeyDrafts,
  setApiKeyDrafts,
  handleSaveApiKey,
}: SettingsModelsSectionProps) {
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const pickerRootRef = useRef<HTMLDivElement | null>(null);

  const selectedProvider = useMemo(() => {
    return searchableProviders.find((provider) => provider.id === selectedProviderId) ?? null;
  }, [selectedProviderId, searchableProviders]);
  const resolvedProvider = selectedProvider ?? (
    currentDefaultModel
      ? searchableProviders.find((provider) => provider.id === currentDefaultModel.providerId) ?? null
      : searchableProviders.find((provider) => provider.models.length > 0) ?? searchableProviders[0] ?? null
  );
  const providerModels = useMemo(() => {
    if (!resolvedProvider) {
      return [];
    }

    return searchableModels.filter((model) => model.providerId === resolvedProvider.id);
  }, [resolvedProvider, searchableModels]);
  const normalizedProviderQuery = providerQuery.trim().toLowerCase();
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const visibleProviderOptions = useMemo(() => {
    if (!normalizedProviderQuery) {
      return searchableProviders;
    }

    return searchableProviders.filter((provider) => provider.searchText.includes(normalizedProviderQuery));
  }, [normalizedProviderQuery, searchableProviders]);
  const visibleModelOptions = useMemo(() => {
    if (!normalizedModelQuery) {
      return providerModels;
    }

    return providerModels.filter((model) => model.searchText.includes(normalizedModelQuery));
  }, [normalizedModelQuery, providerModels]);

  useEffect(() => {
    if (selectedProviderId || !currentDefaultModel) {
      return;
    }

    setSelectedProviderId(currentDefaultModel.providerId);
  }, [currentDefaultModel, selectedProviderId]);

  useEffect(() => {
    if (!providerPickerOpen && !modelPickerOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!pickerRootRef.current?.contains(event.target as Node)) {
        setProviderPickerOpen(false);
        setModelPickerOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProviderPickerOpen(false);
        setModelPickerOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modelPickerOpen, providerPickerOpen]);

  function handleProviderSelect(provider: SearchableProvider) {
    setSelectedProviderId(provider.id);
    setProviderPickerOpen(false);
    setProviderQuery("");
    setModelQuery("");
  }

  function handleModelSelect(model: SearchableModel) {
    if (model.isDefault || savingModelKey !== null) {
      return;
    }

    handleSelectModel(model.providerId, model.modelId);
    setModelPickerOpen(false);
    setModelQuery("");
  }

  return (
    <>
      {active && (
        <div className="space-y-3">
          {providersError ? (
            <p className="ui-feedback mt-3 px-3 py-2.5 text-[0.82rem] leading-normal font-medium">
              {providersError}
            </p>
          ) : null}

          {providers && providers.providers.length === 0 ? (
            <p className="mt-3 border border-dashed border-slate-300 py-4 text-center text-sm font-semibold text-slate-500">
              No active providers configured yet.
            </p>
          ) : null}

          {providers && providers.providers.length > 0 ? (
            <div className="mt-3 space-y-4">
                <div ref={pickerRootRef} className="mt-3 max-w-3xl space-y-3">
                  <div className="relative">
                    <button
                      type="button"
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded border border-black/10 bg-white px-3 py-2.5 text-left text-black transition-colors hover:border-black/20 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                      onClick={() => {
                        setProviderPickerOpen((open) => !open);
                        setModelPickerOpen(false);
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={providerPickerOpen}
                    >
                      <span className="min-w-0">
                        <span className="block text-[0.72rem] font-normal text-slate-500">
                          Provider
                        </span>
                        <span className="mt-0.5 block truncate text-sm font-normal text-black">
                          {resolvedProvider ? resolvedProvider.label : "Choose provider"}
                        </span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    </button>

                    {providerPickerOpen ? (
                      <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden rounded border border-black/10 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
                        <div className="border-b border-black/8 px-3 py-3">
                          <p className="text-sm font-normal text-black">
                            {searchableProviders.length} provider{searchableProviders.length === 1 ? "" : "s"} available
                          </p>
                          <p className="mt-1 text-[0.82rem] font-normal text-black">
                            Current: {resolvedProvider ? resolvedProvider.label : "None"}
                          </p>
                          {providerAuthError ? (
                            <p className="mt-2 text-[0.78rem] font-normal text-black">{providerAuthError}</p>
                          ) : null}
                        </div>
                        <Command shouldFilter={false}>
                          <CommandInput
                            value={providerQuery}
                            onValueChange={setProviderQuery}
                            placeholder="Search providers..."
                          />
                          <CommandList className="max-h-110">
                            <CommandEmpty>No providers match that search.</CommandEmpty>
                            <CommandGroup heading="Providers">
                              {visibleProviderOptions.map((provider) => {
                                const isSelected = provider.id === resolvedProvider?.id;
                                const isApiKeyOpen = apiKeyEditorProviderId === provider.id;
                                const isAuthBusy = authActionProviderId === provider.id;
                                return (
                                  <CommandItem
                                    key={provider.id}
                                    value={`${provider.label} ${provider.id}`}
                                    onSelect={() => handleProviderSelect(provider)}
                                    className="items-start"
                                  >
                                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                                      {isSelected ? (
                                        <Check className="h-3.5 w-3.5 text-black" />
                                      ) : (
                                        <span className="h-2 w-2 rounded bg-black/70" />
                                      )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-normal text-black">
                                        {provider.label}
                                      </span>
                                      <span className="mt-0.5 block break-all text-[0.74rem] font-mono font-normal text-black">
                                        {provider.id} · {getProviderAuthLabel(provider)} · {getProviderStatusLabel(provider)}
                                      </span>
                                      <span className="mt-1 block text-[0.76rem] font-normal text-slate-600">
                                        {getProviderAuthMessage(provider)}
                                      </span>
                                      {provider.supportsOAuth || provider.supportsApiKey ? (
                                        <span className="mt-2 flex flex-wrap items-center gap-2">
                                          {provider.supportsOAuth ? (
                                            <button
                                              type="button"
                                              className="ui-button-secondary border px-2.5 py-1.5 text-[0.72rem] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                                              onPointerDown={stopPickerButtonEvent}
                                              onMouseDown={stopPickerButtonEvent}
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                handleStartLogin(provider.id);
                                              }}
                                              disabled={authActionProviderId !== null || provider.loginState.status === "pending"}
                                            >
                                              {isAuthBusy && provider.loginState.status !== "pending"
                                                ? "Opening..."
                                                : provider.loginState.status === "pending"
                                                  ? "Awaiting Browser"
                                                  : "Login with Provider"}
                                            </button>
                                          ) : null}
                                          {provider.supportsApiKey ? (
                                            <button
                                              type="button"
                                              className="ui-button-secondary border px-2.5 py-1.5 text-[0.72rem] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                                              onPointerDown={stopPickerButtonEvent}
                                              onMouseDown={stopPickerButtonEvent}
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setApiKeyEditorProviderId((current) => current === provider.id ? null : provider.id);
                                                setProviderAuthError(null);
                                              }}
                                              disabled={authActionProviderId !== null}
                                            >
                                              {isApiKeyOpen ? "Hide API Key" : "Use API Key"}
                                            </button>
                                          ) : null}
                                        </span>
                                      ) : null}
                                      {provider.supportsApiKey && isApiKeyOpen ? (
                                        <span
                                          className="mt-2 block border-t border-(--color-brand-line) pt-2"
                                          onPointerDown={(event) => event.stopPropagation()}
                                          onMouseDown={(event) => event.stopPropagation()}
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          <input
                                            type="password"
                                            value={apiKeyDrafts[provider.id] ?? ""}
                                            onChange={(event) => {
                                              const nextValue = event.target.value;
                                              setApiKeyDrafts((previous) => ({
                                                ...previous,
                                                [provider.id]: nextValue,
                                              }));
                                            }}
                                            onKeyDown={(event) => event.stopPropagation()}
                                            placeholder="Paste API key"
                                            className="ui-field-line w-full border-b bg-transparent px-0 py-2 text-sm text-[#171717] placeholder:text-slate-400 outline-none"
                                            autoComplete="off"
                                            spellCheck={false}
                                          />
                                          <span className="mt-2 flex flex-wrap items-center gap-2">
                                            <button
                                              type="button"
                                              className="ui-button-primary border px-2.5 py-1.5 text-[0.72rem] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                                              onPointerDown={stopPickerButtonEvent}
                                              onMouseDown={stopPickerButtonEvent}
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                handleSaveApiKey(provider.id);
                                              }}
                                              disabled={authActionProviderId !== null}
                                            >
                                              {isAuthBusy ? "Saving..." : "Save API Key"}
                                            </button>
                                            <span className="text-[0.74rem] font-normal text-slate-500">
                                              Saved locally for this machine.
                                            </span>
                                          </span>
                                        </span>
                                      ) : null}
                                    </span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </div>
                    ) : null}
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded border border-black/10 bg-white px-3 py-2.5 text-left text-black transition-colors hover:border-black/20 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        setModelPickerOpen((open) => !open);
                        setProviderPickerOpen(false);
                      }}
                      disabled={!resolvedProvider || savingModelKey !== null}
                      aria-haspopup="dialog"
                      aria-expanded={modelPickerOpen}
                      title={currentDefaultModel ? `${currentDefaultModel.providerLabel} · ${currentDefaultModel.modelId}` : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block text-[0.72rem] font-normal text-slate-500">
                          Model
                        </span>
                        <span className="mt-0.5 block truncate text-sm font-normal text-black">
                          {currentDefaultModel && currentDefaultModel.providerId === resolvedProvider?.id
                            ? currentDefaultModel.label
                            : providerModels.length > 0
                              ? "Choose model"
                              : "No models indexed"}
                        </span>
                      </span>
                      {savingModelKey ? (
                        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>

                    {modelPickerOpen ? (
                      <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-full overflow-hidden rounded border border-black/10 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
                        <div className="border-b border-black/8 px-3 py-3">
                          <p className="text-sm font-normal text-black">
                            {resolvedProvider ? `${resolvedProvider.label} models` : "Model picker"}
                          </p>
                          <p className="mt-1 text-[0.82rem] font-normal text-black">
                            {providerModels.length} model{providerModels.length === 1 ? "" : "s"} available
                          </p>
                          {modelUpdateError ? (
                            <p className="mt-2 text-[0.78rem] font-normal text-black">{modelUpdateError}</p>
                          ) : null}
                        </div>
                        <Command shouldFilter={false}>
                          <CommandInput
                            value={modelQuery}
                            onValueChange={setModelQuery}
                            placeholder="Search models..."
                          />
                          <CommandList>
                            {providerModels.length === 0 ? (
                              <div className="px-3 py-5 text-center text-sm font-normal text-black">
                                No models are available for this provider yet.
                              </div>
                            ) : (
                              <>
                                <CommandEmpty>No models match that search.</CommandEmpty>
                                <CommandGroup heading="Available models">
                                  {visibleModelOptions.map((model) => {
                                    const isSaving = savingModelKey === model.key;
                                    return (
                                      <CommandItem
                                        key={model.key}
                                        value={`${model.label} ${model.providerLabel} ${model.modelId}`}
                                        onSelect={() => handleModelSelect(model)}
                                        disabled={isSaving || savingModelKey !== null}
                                      >
                                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                                          {isSaving ? (
                                            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-black" />
                                          ) : model.isDefault ? (
                                            <Check className="h-3.5 w-3.5 text-black" />
                                          ) : (
                                            <span className="h-2 w-2 rounded bg-black/70" />
                                          )}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-sm font-normal text-black">
                                            {model.label}
                                          </span>
                                          <span className="mt-0.5 block break-all text-[0.74rem] font-mono font-normal text-black">
                                            {model.modelId} · {model.providerLabel} · {model.authType === "oauth" ? "Subscription" : "Custom key"}
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
                </div>

              {modelUpdateMessage ? (
                <p className="ui-feedback-soft px-3 py-2.5 text-xs leading-normal font-medium">
                  {modelUpdateMessage}
                </p>
              ) : null}
              {modelUpdateError ? (
                <p className="ui-feedback px-3 py-2.5 text-xs leading-normal font-medium">
                  {modelUpdateError}
                </p>
              ) : null}
              {providerAuthError && !providerPickerOpen ? (
                <p className="ui-feedback px-3 py-2.5 text-xs leading-normal font-medium">
                  {providerAuthError}
                </p>
              ) : null}
            </div>
          ) : null}

          {!providers && !providersError ? (
            <p className="mt-4 text-center text-sm font-semibold text-slate-400">
              Reading system models...
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
