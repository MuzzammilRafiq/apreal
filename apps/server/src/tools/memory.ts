import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { MemorySearchResult, MemoryStore, MemoryType, StoredMemory, StoredMemoryItem } from "../memory-store.ts";

const memoryToolParameters = Type.Object({
	action: Type.Union([
		Type.Literal("read"),
		Type.Literal("write"),
		Type.Literal("update"),
		Type.Literal("forget"),
	]),
	target: Type.Union([
		Type.Literal("memory"),
		Type.Literal("item"),
	]),
	memoryId: Type.Optional(Type.String({
		description: "Memory block id. Required for item writes, memory updates/deletes, and targeted reads.",
	})),
	itemId: Type.Optional(Type.String({
		description: "Memory item id. Required for item reads, item updates, and item deletes.",
	})),
	memoryType: Type.Optional(Type.Union([
		Type.Literal("always"),
		Type.Literal("search"),
	])),
	title: Type.Optional(Type.String({
		description: "Memory block title. Required when writing a memory block.",
	})),
	description: Type.Optional(Type.String({
		description: "Short description for the memory block or memory item.",
	})),
	content: Type.Optional(Type.String({
		description: "Memory item content. Prefer a single granular memory string with a short description; split very large content into multiple items when practical.",
	})),
	query: Type.Optional(Type.String({
		description: "Optional search query for reading matching memory blocks.",
	})),
	view: Type.Optional(Type.Union([
		Type.Literal("summary"),
		Type.Literal("full"),
	])),
	limit: Type.Optional(Type.Number({
		description: "Maximum number of memory blocks to return. Defaults to 20 for list reads and 5 for query reads.",
		minimum: 1,
		maximum: 50,
	})),
});

type MemoryToolParams = Static<typeof memoryToolParameters>;
type MemoryAction = "read" | "write" | "update" | "forget";
type MemoryTarget = "memory" | "item";
type MemoryView = "summary" | "full";

function normalizeLimit(limit: number | undefined, fallback: number): number {
	if (limit === undefined || !Number.isFinite(limit)) {
		return fallback;
	}

	return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function formatTimestamp(value: number): string {
	return new Date(value).toISOString();
}

function formatMemoryItem(item: StoredMemoryItem, view: MemoryView = "summary") {
	return {
		id: item.id,
		memoryId: item.memoryId,
		description: item.description,
		lineCount: item.lineCount,
		position: item.position,
		createdAt: formatTimestamp(item.createdAt),
		updatedAt: formatTimestamp(item.updatedAt),
		...(view === "full" ? { content: item.content } : {}),
	};
}

function formatMemory(memory: StoredMemory, options?: {
	view?: MemoryView;
	itemIds?: string[];
}) {
	const view = options?.view ?? "summary";
	const itemIds = options?.itemIds;
	const visibleItems = itemIds
		? memory.items.filter((item) => itemIds.includes(item.id))
		: memory.items;

	return {
		id: memory.id,
		memoryType: memory.memoryType,
		title: memory.title,
		description: memory.description,
		itemCount: memory.items.length,
		createdAt: formatTimestamp(memory.createdAt),
		updatedAt: formatTimestamp(memory.updatedAt),
		items: visibleItems.map((item) => formatMemoryItem(item, view)),
	};
}

function formatSearchResult(result: MemorySearchResult) {
	return {
		score: result.score,
		matchedItemIds: result.matchedItemIds,
		memory: formatMemory(result.memory, {
			view: "summary",
			itemIds: result.matchedItemIds.length > 0 ? result.matchedItemIds : undefined,
		}),
	};
}

function readRequiredMemoryId(memoryId: string | undefined): string {
	const normalized = memoryId?.trim();
	if (!normalized) {
		throw new Error("memoryId is required for this action.");
	}

	return normalized;
}

function readRequiredItemId(itemId: string | undefined): string {
	const normalized = itemId?.trim();
	if (!normalized) {
		throw new Error("itemId is required for this action.");
	}

	return normalized;
}

function readRequiredMemoryType(memoryType: MemoryType | undefined): MemoryType {
	if (memoryType !== "always" && memoryType !== "search") {
		throw new Error("memoryType must be either 'always' or 'search'.");
	}

	return memoryType;
}

function readRequiredTitle(title: string | undefined): string {
	const normalized = title?.trim();
	if (!normalized) {
		throw new Error("title is required when writing a memory block.");
	}

	return normalized;
}

function readRequiredContent(content: string | undefined): string {
	const normalized = content?.trim();
	if (!normalized) {
		throw new Error("content must be a non-empty string for memory items.");
	}

	return normalized;
}

function readRequiredDescription(description: string | undefined): string {
	const normalized = description?.trim();
	if (!normalized) {
		throw new Error("description is required for granular memory items.");
	}

	return normalized;
}

function readRequiredQuery(query: string | undefined): string {
	const normalized = query?.trim();
	if (!normalized) {
		throw new Error("query must be a non-empty string.");
	}

	return normalized;
}

function normalizeView(view: MemoryView | undefined, fallback: MemoryView): MemoryView {
	return view === "full" ? "full" : fallback;
}

function buildDetails(input: {
	action: MemoryAction;
	target: MemoryTarget;
	memoryId?: string | null;
	itemId?: string | null;
	memoryType?: MemoryType | null;
	count?: number | null;
	query?: string | null;
	view?: MemoryView | null;
}) {
	return {
		action: input.action,
		target: input.target,
		memoryId: input.memoryId ?? null,
		itemId: input.itemId ?? null,
		memoryType: input.memoryType ?? null,
		count: input.count ?? null,
		query: input.query ?? null,
		view: input.view ?? null,
	};
}

export function createMemoryTool(store: MemoryStore) {
	return defineTool({
		name: "memory",
		label: "Memory",
		description:
			"Manages persistent server memory as granular memory blocks and items. Use write/update/forget for blocks or individual items, and use read to inspect summaries or retrieve full item content on demand.",
		parameters: memoryToolParameters as any,
		async execute(_toolCallId, params: MemoryToolParams) {
			switch (params.action) {
				case "read": {
					if (params.target === "item") {
						const itemId = readRequiredItemId(params.itemId);
						const memoryId = params.memoryId?.trim() || undefined;
						const item = store.getItem(itemId, memoryId);
						if (!item) {
							throw new Error(`Memory item not found: ${itemId}`);
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											action: "read",
											target: "item",
											item: formatMemoryItem(item, "full"),
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "read",
								target: "item",
								memoryId: memoryId ?? null,
								itemId,
								view: "full",
							}),
						};
					}

					if (params.query?.trim()) {
						const query = readRequiredQuery(params.query);
						const results = store.search(query, {
							memoryType: params.memoryType,
							limit: normalizeLimit(params.limit, 5),
						});

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											action: "read",
											target: "memory",
											mode: "search",
											query,
											count: results.length,
											results: results.map(formatSearchResult),
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "read",
								target: "memory",
								memoryType: params.memoryType ?? null,
								count: results.length,
								query,
								view: "summary",
							}),
						};
					}

					if (params.memoryId?.trim()) {
						const memoryId = params.memoryId.trim();
						const memory = store.getMemory(memoryId);
						if (!memory) {
							throw new Error(`Memory not found: ${memoryId}`);
						}

						const view = normalizeView(params.view as MemoryView | undefined, "summary");
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											action: "read",
											target: "memory",
											memory: formatMemory(memory, { view }),
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "read",
								target: "memory",
								memoryId,
								memoryType: memory.memoryType,
								view,
							}),
						};
					}

					const results = store.listAll(
						params.memoryType,
						normalizeLimit(params.limit, 20),
					);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										action: "read",
										target: "memory",
										mode: "list",
										count: results.length,
										results: results.map((memory) => formatMemory(memory, { view: "summary" })),
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "read",
							target: "memory",
							memoryType: params.memoryType ?? null,
							count: results.length,
							view: "summary",
						}),
					};
				}
				case "write": {
					if (params.target === "memory") {
						const memory = store.createMemory({
							memoryId: params.memoryId?.trim() || undefined,
							memoryType: readRequiredMemoryType(params.memoryType),
							title: readRequiredTitle(params.title),
							description: params.description?.trim() || undefined,
						});

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: true,
											action: "write",
											target: "memory",
											memory: formatMemory(memory, { view: "summary" }),
											behavior: memory.memoryType === "always"
												? "Only the memory and item summaries are always loaded. Read item content on demand."
												: "This memory block is saved for later reads and searches.",
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "write",
								target: "memory",
								memoryId: memory.id,
								memoryType: memory.memoryType,
								view: "summary",
							}),
						};
					}

					const item = store.addItem({
						memoryId: readRequiredMemoryId(params.memoryId),
						itemId: params.itemId?.trim() || undefined,
						description: readRequiredDescription(params.description),
						content: readRequiredContent(params.content),
					});

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "write",
										target: "item",
										item: formatMemoryItem(item, "full"),
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "write",
							target: "item",
							memoryId: item.memoryId,
							itemId: item.id,
							view: "full",
						}),
					};
				}
				case "update": {
					if (params.target === "memory") {
						const memoryId = readRequiredMemoryId(params.memoryId);
						if (
							params.memoryType === undefined &&
							params.title?.trim() === undefined &&
							params.description?.trim() === undefined
						) {
							throw new Error("Provide at least one of memoryType, title, or description to update a memory block.");
						}

						const memory = store.updateMemory({
							memoryId,
							memoryType: params.memoryType,
							title: params.title?.trim() || undefined,
							description: params.description?.trim() || undefined,
						});

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: true,
											action: "update",
											target: "memory",
											memory: formatMemory(memory, { view: "summary" }),
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "update",
								target: "memory",
								memoryId: memory.id,
								memoryType: memory.memoryType,
								view: "summary",
							}),
						};
					}

					const itemId = readRequiredItemId(params.itemId);
					if (params.description?.trim() === undefined && params.content?.trim() === undefined) {
						throw new Error("Provide description or content to update a memory item.");
					}

					const item = store.updateItem({
						itemId,
						memoryId: params.memoryId?.trim() || undefined,
						description: params.description?.trim() || undefined,
						content: params.content?.trim() || undefined,
					});

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "update",
										target: "item",
										item: formatMemoryItem(item, "full"),
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "update",
							target: "item",
							memoryId: item.memoryId,
							itemId: item.id,
							view: "full",
						}),
					};
				}
				case "forget": {
					if (params.target === "memory") {
						const memoryId = readRequiredMemoryId(params.memoryId);
						if (!store.deleteMemory(memoryId)) {
							throw new Error(`Memory not found: ${memoryId}`);
						}

						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: true,
											action: "forget",
											target: "memory",
											memoryId,
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "forget",
								target: "memory",
								memoryId,
							}),
						};
					}

					const itemId = readRequiredItemId(params.itemId);
					const memoryId = params.memoryId?.trim() || undefined;
					if (!store.deleteItem(itemId, memoryId)) {
						throw new Error(`Memory item not found: ${itemId}`);
					}

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "forget",
										target: "item",
										memoryId: memoryId ?? null,
										itemId,
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "forget",
							target: "item",
							memoryId: memoryId ?? null,
							itemId,
						}),
					};
				}
			}
		},
	});
}
