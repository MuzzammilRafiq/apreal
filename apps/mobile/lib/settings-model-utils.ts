import type { ProvidersResponse } from "@apreal/shared";

export type SearchableModel = {
  key: string;
  providerId: string;
  providerLabel: string;
  authType: "oauth" | "api_key";
  modelId: string;
  modelName: string;
  label: string;
  searchText: string;
  isDefault: boolean;
};

export function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

export function formatProviderId(id: string) {
  return id
    .split("-")
    .map((part) => {
      if (!part) {
        return part;
      }

      if (part.length <= 3) {
        return part.toUpperCase();
      }

      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
    })
    .join(" ");
}

export function getSearchableModels(providers: ProvidersResponse | null) {
  if (!providers) {
    return [] as SearchableModel[];
  }

  const flattened = providers.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: `${provider.id}:${model.id}`,
      providerId: provider.id,
      providerLabel: formatProviderId(provider.id),
      authType: provider.authType,
      modelId: model.id,
      modelName: model.name,
      isDefault:
        provider.id === providers.defaultProvider &&
        model.id === providers.defaultModel,
    })),
  );
  const duplicateNameCounts = new Map<string, number>();

  for (const item of flattened) {
    const key = normalizeSearchValue(item.modelName);
    duplicateNameCounts.set(key, (duplicateNameCounts.get(key) ?? 0) + 1);
  }

  return flattened
    .map((item) => {
      const duplicateNameCount =
        duplicateNameCounts.get(normalizeSearchValue(item.modelName)) ?? 0;
      const label =
        duplicateNameCount > 1
          ? `${item.modelName} (${item.providerLabel})`
          : item.modelName;

      return {
        ...item,
        label,
        searchText: normalizeSearchValue(
          `${item.modelName} ${item.modelId} ${item.providerLabel} ${item.providerId}`,
        ),
      };
    })
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) ||
        left.modelName.localeCompare(right.modelName) ||
        left.providerLabel.localeCompare(right.providerLabel) ||
        left.modelId.localeCompare(right.modelId),
    );
}
