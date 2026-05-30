import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAprealServerDatabasePath } from "./agent-dir.ts";
import { createLogger, summarizePrompt } from "./logger.ts";

const logger = createLogger("memory-store");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
	id TEXT PRIMARY KEY,
	memory_type TEXT NOT NULL CHECK (memory_type IN ('always', 'search')),
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	content TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
	id TEXT PRIMARY KEY,
	memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
	description TEXT NOT NULL,
	content TEXT NOT NULL,
	position INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_type_updated
ON memories(memory_type, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_memory_position
ON memory_items(memory_id, position ASC, created_at ASC, id ASC);
`;

const ALWAYS_LOADED_MEMORY_VIRTUAL_PATH = "/virtual/PERSISTENT_SERVER_MEMORY.md";
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_SEARCH_LIMIT = 5;
const ALWAYS_LOADED_MAX_MEMORIES = 12;
const ALWAYS_LOADED_MAX_ITEMS_PER_MEMORY = 8;
const ALWAYS_LOADED_MAX_CHARS = 6_000;

export type MemoryType = "always" | "search";

export type StoredMemoryItem = {
	id: string;
	memoryId: string;
	description: string;
	content: string;
	lineCount: number;
	position: number;
	createdAt: number;
	updatedAt: number;
};

export type StoredMemory = {
	id: string;
	memoryType: MemoryType;
	title: string;
	description: string;
	items: StoredMemoryItem[];
	createdAt: number;
	updatedAt: number;
};

export type CreateMemoryInput = {
	memoryId?: string;
	memoryType: MemoryType;
	title: string;
	description?: string;
};

export type AddMemoryItemInput = {
	memoryId: string;
	itemId?: string;
	description?: string;
	content: string;
};

export type UpdateMemoryInput = {
	memoryId: string;
	memoryType?: MemoryType;
	title?: string;
	description?: string;
};

export type UpdateMemoryItemInput = {
	itemId: string;
	memoryId?: string;
	description?: string;
	content?: string;
};

export type SearchMemoriesOptions = {
	memoryType?: MemoryType;
	limit?: number;
};

export type MemorySearchResult = {
	memory: StoredMemory;
	matchedItemIds: string[];
	score: number;
};

export interface MemoryStore {
	createMemory(input: CreateMemoryInput): StoredMemory;
	addItem(input: AddMemoryItemInput): StoredMemoryItem;
	getMemory(memoryId: string): StoredMemory | null;
	getItem(itemId: string, memoryId?: string): StoredMemoryItem | null;
	listAll(memoryType?: MemoryType, limit?: number): StoredMemory[];
	search(query: string, options?: SearchMemoriesOptions): MemorySearchResult[];
	updateMemory(input: UpdateMemoryInput): StoredMemory;
	updateItem(input: UpdateMemoryItemInput): StoredMemoryItem;
	deleteMemory(memoryId: string): boolean;
	deleteItem(itemId: string, memoryId?: string): boolean;
	renderAlwaysLoadedContext(): { path: string; content: string } | null;
}

type MemoryRow = {
	id: string;
	memory_type: MemoryType;
	title: string;
	description: string;
	content: string;
	created_at: number;
	updated_at: number;
};

type MemoryItemRow = {
	id: string;
	memory_id: string;
	description: string;
	content: string;
	position: number;
	created_at: number;
	updated_at: number;
};

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function countLines(content: string): number {
	return content.split(/\r?\n/).length;
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function normalizeTitle(title: string): string {
	const normalized = collapseWhitespace(title);
	if (!normalized) {
		throw new Error("Memory title must be a non-empty string.");
	}
	if (normalized.length > MAX_TITLE_LENGTH) {
		throw new Error(`Memory title must be at most ${MAX_TITLE_LENGTH} characters.`);
	}

	return normalized;
}

function normalizeDescription(
	description: string | undefined,
	fallback: string,
	label: "memory" | "item",
): string {
	const normalized = collapseWhitespace(description ?? "");
	const resolved = normalized || summarizePrompt(fallback, MAX_DESCRIPTION_LENGTH) || `${label} description`;
	if (resolved.length > MAX_DESCRIPTION_LENGTH) {
		throw new Error(`${label === "memory" ? "Memory" : "Memory item"} description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
	}

	return resolved;
}

function normalizeItemContent(content: string): string {
	const normalized = content.trim();
	if (!normalized) {
		throw new Error("Memory item content must be a non-empty string.");
	}

	return normalized;
}

function clampLimit(limit: number | undefined, fallback = DEFAULT_SEARCH_LIMIT): number {
	if (limit === undefined || !Number.isFinite(limit)) {
		return fallback;
	}

	return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(limit)));
}

function tokenizeQuery(query: string): string[] {
	return [...new Set(query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean))];
}

function scoreText(text: string, query: string, terms: string[], exactWeight: number, termWeight: number): number {
	const normalized = text.toLowerCase();
	let score = 0;

	if (normalized.includes(query)) {
		score += exactWeight;
	}

	for (const term of terms) {
		if (normalized.includes(term)) {
			score += termWeight;
		}
	}

	return score;
}

function toStoredMemoryItem(row: MemoryItemRow): StoredMemoryItem {
	return {
		id: row.id,
		memoryId: row.memory_id,
		description: row.description,
		content: row.content,
		lineCount: countLines(row.content),
		position: row.position,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toStoredMemory(row: MemoryRow, items: StoredMemoryItem[]): StoredMemory {
	return {
		id: row.id,
		memoryType: row.memory_type,
		title: row.title,
		description: row.description,
		items,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function runInTransaction(database: DatabaseSync, callback: () => void) {
	database.exec("BEGIN");
	try {
		callback();
		database.exec("COMMIT");
	} catch (error) {
		try {
			database.exec("ROLLBACK");
		} catch (rollbackError) {
			logger.error("failed to roll back memory-store transaction", { error: formatError(rollbackError) });
		}
		throw error;
	}
}

function ensureMemoryStoreSchema(database: DatabaseSync) {
	database.exec(SCHEMA_SQL);

	const memoryColumns = database.prepare("PRAGMA table_info(memories)").all() as Array<{ name?: unknown }>;
	const hasDescriptionColumn = memoryColumns.some((column) => column.name === "description");
	if (!hasDescriptionColumn) {
		database.exec("ALTER TABLE memories ADD COLUMN description TEXT NOT NULL DEFAULT '';");
	}

	const hasContentColumn = memoryColumns.some((column) => column.name === "content");
	if (!hasContentColumn) {
		database.exec("ALTER TABLE memories ADD COLUMN content TEXT NOT NULL DEFAULT '';");
	}

	migrateLegacyMemoryContent(database);
}

function migrateLegacyMemoryContent(database: DatabaseSync) {
	const legacyRows = database.prepare(`
		SELECT id, title, description, content, created_at, updated_at
		FROM memories
		WHERE TRIM(COALESCE(content, '')) != ''
			AND NOT EXISTS (
				SELECT 1
				FROM memory_items
				WHERE memory_items.memory_id = memories.id
				LIMIT 1
			)
	`).all() as MemoryRow[];

	if (legacyRows.length === 0) {
		return;
	}

	const insertItemStatement = database.prepare(`
		INSERT INTO memory_items (id, memory_id, description, content, position, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`);
	const updateMemoryStatement = database.prepare(`
		UPDATE memories
		SET description = ?, content = ''
		WHERE id = ?
	`);

	runInTransaction(database, () => {
		for (const row of legacyRows) {
			const content = row.content.trim();
			const itemDescription = normalizeDescription(undefined, content, "item");
			const memoryDescription = row.description.trim()
				? normalizeDescription(row.description, row.title, "memory")
				: normalizeDescription(undefined, content, "memory");

			insertItemStatement.run(
				randomUUID(),
				row.id,
				itemDescription,
				content,
				1,
				row.created_at,
				row.updated_at,
			);
			updateMemoryStatement.run(memoryDescription, row.id);
		}
	});

	logger.info("migrated legacy memories to granular items", { migratedCount: legacyRows.length });
}

function renderAlwaysLoadedMemoryContext(memories: StoredMemory[]): { path: string; content: string } | null {
	if (memories.length === 0) {
		return null;
	}

	const sections = [
		"# Persistent Server Memory Index",
		"These are compact summaries of always-loaded memories. Use the `memory` tool to read full item content only when needed.",
	];

	let omittedMemories = 0;
	for (const [index, memory] of memories.entries()) {
		const itemLines = memory.items.slice(0, ALWAYS_LOADED_MAX_ITEMS_PER_MEMORY).map((item) =>
			`- ${item.id}: ${item.description} (${item.lineCount} line${item.lineCount === 1 ? "" : "s"})`
		);
		if (memory.items.length > ALWAYS_LOADED_MAX_ITEMS_PER_MEMORY) {
			itemLines.push(`- ... ${memory.items.length - ALWAYS_LOADED_MAX_ITEMS_PER_MEMORY} more item(s) omitted`);
		}

		const section = [
			`## ${index + 1}. ${memory.title}`,
			`Memory ID: ${memory.id}`,
			`Description: ${memory.description}`,
			`Items (${memory.items.length}):`,
			...(itemLines.length > 0 ? itemLines : ["- No items saved yet"]),
		].join("\n");

		const nextContent = [...sections, section].join("\n\n");
		if (nextContent.length > ALWAYS_LOADED_MAX_CHARS) {
			omittedMemories = memories.length - index;
			break;
		}

		sections.push(section);
	}

	if (omittedMemories > 0) {
		sections.push(`... ${omittedMemories} more always-loaded memory block(s) omitted to keep the prompt lean.`);
	}

	return {
		path: ALWAYS_LOADED_MEMORY_VIRTUAL_PATH,
		content: sections.join("\n\n"),
	};
}

export function getDefaultServerDatabasePath(): string {
	return getAprealServerDatabasePath();
}

let defaultMemoryStore: MemoryStore | null = null;

export function getDefaultMemoryStore(): MemoryStore {
	if (!defaultMemoryStore) {
		defaultMemoryStore = createMemoryStore(getDefaultServerDatabasePath());
	}

	return defaultMemoryStore;
}

export function createMemoryStore(dbPath: string): MemoryStore {
	mkdirSync(dirname(dbPath), { recursive: true });
	const database = new DatabaseSync(dbPath, {
		enableForeignKeyConstraints: true,
		timeout: 1_000,
	});
	database.exec("PRAGMA foreign_keys = ON;");
	database.exec("PRAGMA journal_mode = WAL;");
	ensureMemoryStoreSchema(database);

	const getMemoryStatement = database.prepare(`
		SELECT id, memory_type, title, description, content, created_at, updated_at
		FROM memories
		WHERE id = ?
	`);
	const getMemoryItemStatement = database.prepare(`
		SELECT id, memory_id, description, content, position, created_at, updated_at
		FROM memory_items
		WHERE id = ?
	`);
	const getMemoryItemForMemoryStatement = database.prepare(`
		SELECT id, memory_id, description, content, position, created_at, updated_at
		FROM memory_items
		WHERE id = ? AND memory_id = ?
	`);
	const listMemoryItemsStatement = database.prepare(`
		SELECT id, memory_id, description, content, position, created_at, updated_at
		FROM memory_items
		WHERE memory_id = ?
		ORDER BY position ASC, created_at ASC, id ASC
	`);
	const listMemoriesStatement = database.prepare(`
		SELECT id, memory_type, title, description, content, created_at, updated_at
		FROM memories
		ORDER BY updated_at DESC, created_at DESC, id DESC
		LIMIT ?
	`);
	const listMemoriesByTypeStatement = database.prepare(`
		SELECT id, memory_type, title, description, content, created_at, updated_at
		FROM memories
		WHERE memory_type = ?
		ORDER BY updated_at DESC, created_at DESC, id DESC
		LIMIT ?
	`);
	const insertMemoryStatement = database.prepare(`
		INSERT INTO memories (id, memory_type, title, description, content, created_at, updated_at)
		VALUES (?, ?, ?, ?, '', ?, ?)
	`);
	const updateMemoryStatement = database.prepare(`
		UPDATE memories
		SET memory_type = ?, title = ?, description = ?, updated_at = ?
		WHERE id = ?
	`);
	const nextMemoryItemPositionStatement = database.prepare(`
		SELECT COALESCE(MAX(position), 0) + 1 AS next_position
		FROM memory_items
		WHERE memory_id = ?
	`);
	const insertMemoryItemStatement = database.prepare(`
		INSERT INTO memory_items (id, memory_id, description, content, position, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`);
	const updateMemoryItemStatement = database.prepare(`
		UPDATE memory_items
		SET description = ?, content = ?, updated_at = ?
		WHERE id = ?
	`);
	const deleteMemoryStatement = database.prepare("DELETE FROM memories WHERE id = ?");
	const deleteMemoryItemStatement = database.prepare("DELETE FROM memory_items WHERE id = ?");
	const deleteMemoryItemForMemoryStatement = database.prepare("DELETE FROM memory_items WHERE id = ? AND memory_id = ?");

	const hydrateMemory = (row: MemoryRow): StoredMemory => {
		const itemRows = listMemoryItemsStatement.all(row.id) as MemoryItemRow[];
		return toStoredMemory(row, itemRows.map(toStoredMemoryItem));
	};

	const readExistingMemory = (memoryId: string): MemoryRow => {
		const row = getMemoryStatement.get(memoryId) as MemoryRow | undefined;
		if (!row) {
			throw new Error(`Memory not found: ${memoryId}`);
		}
		return row;
	};

	logger.info("memory store initialized", { dbPath });

	return {
		createMemory(input) {
			const memoryId = input.memoryId?.trim() || randomUUID();
			const title = normalizeTitle(input.title);
			const description = normalizeDescription(input.description, title, "memory");
			const now = Date.now();

			insertMemoryStatement.run(memoryId, input.memoryType, title, description, now, now);

			return hydrateMemory(readExistingMemory(memoryId));
		},
		addItem(input) {
			const memoryId = input.memoryId.trim();
			const parent = readExistingMemory(memoryId);

			const itemId = input.itemId?.trim() || randomUUID();
			const content = normalizeItemContent(input.content);
			const description = normalizeDescription(input.description, content, "item");
			const now = Date.now();
			const nextPositionRow = nextMemoryItemPositionStatement.get(memoryId) as { next_position?: number } | undefined;
			const position = typeof nextPositionRow?.next_position === "number" ? nextPositionRow.next_position : 1;

			insertMemoryItemStatement.run(itemId, memoryId, description, content, position, now, now);
			updateMemoryStatement.run(
				parent.memory_type,
				parent.title,
				parent.description,
				now,
				memoryId,
			);

			const row = getMemoryItemStatement.get(itemId) as MemoryItemRow | undefined;
			if (!row) {
				throw new Error(`Failed to load saved memory item: ${itemId}`);
			}

			return toStoredMemoryItem(row);
		},
		getMemory(memoryId) {
			const row = getMemoryStatement.get(memoryId.trim()) as MemoryRow | undefined;
			return row ? hydrateMemory(row) : null;
		},
		getItem(itemId, memoryId) {
			const normalizedItemId = itemId.trim();
			const row = memoryId?.trim()
				? getMemoryItemForMemoryStatement.get(normalizedItemId, memoryId.trim())
				: getMemoryItemStatement.get(normalizedItemId);
			return row ? toStoredMemoryItem(row as MemoryItemRow) : null;
		},
		listAll(memoryType, limit = DEFAULT_LIST_LIMIT) {
			const normalizedLimit = clampLimit(limit, DEFAULT_LIST_LIMIT);
			const rows = memoryType
				? listMemoriesByTypeStatement.all(memoryType, normalizedLimit)
				: listMemoriesStatement.all(normalizedLimit);
			return (rows as MemoryRow[]).map(hydrateMemory);
		},
		search(query, options) {
			const normalizedQuery = query.trim().toLowerCase();
			if (!normalizedQuery) {
				return [];
			}

			const memories = this.listAll(options?.memoryType, MAX_LIST_LIMIT);
			const terms = tokenizeQuery(normalizedQuery);
			return memories
				.map((memory) => {
					const matchedItemIds: string[] = [];
					let score = 0;

					score += scoreText(memory.title, normalizedQuery, terms, 10, 3);
					score += scoreText(memory.description, normalizedQuery, terms, 8, 2);

					for (const item of memory.items) {
						const itemScore =
							scoreText(item.description, normalizedQuery, terms, 6, 2) +
							scoreText(item.content, normalizedQuery, terms, 4, 1);
						if (itemScore > 0) {
							matchedItemIds.push(item.id);
							score += itemScore;
						}
					}

					return { memory, matchedItemIds, score };
				})
				.filter((entry) => entry.score > 0)
				.sort((left, right) =>
					right.score - left.score ||
					right.memory.updatedAt - left.memory.updatedAt ||
					right.memory.createdAt - left.memory.createdAt ||
					right.memory.id.localeCompare(left.memory.id),
				)
				.slice(0, clampLimit(options?.limit))
				.map((entry) => ({
					memory: entry.memory,
					matchedItemIds: entry.matchedItemIds,
					score: entry.score,
				}));
		},
		updateMemory(input) {
			const current = readExistingMemory(input.memoryId.trim());
			const nextMemoryType = input.memoryType ?? current.memory_type;
			const nextTitle = input.title === undefined ? current.title : normalizeTitle(input.title);
			const nextDescription = input.description === undefined
				? current.description
				: normalizeDescription(input.description, nextTitle, "memory");
			const now = Date.now();

			updateMemoryStatement.run(nextMemoryType, nextTitle, nextDescription, now, current.id);
			return hydrateMemory(readExistingMemory(current.id));
		},
		updateItem(input) {
			const current = input.memoryId?.trim()
				? getMemoryItemForMemoryStatement.get(input.itemId.trim(), input.memoryId.trim())
				: getMemoryItemStatement.get(input.itemId.trim());
			if (!current) {
				throw new Error(`Memory item not found: ${input.itemId.trim()}`);
			}

			const currentRow = current as MemoryItemRow;
			const nextContent = input.content === undefined ? currentRow.content : normalizeItemContent(input.content);
			const nextDescription = input.description === undefined
				? currentRow.description
				: normalizeDescription(input.description, nextContent, "item");
			const now = Date.now();
			const parent = readExistingMemory(currentRow.memory_id);

			updateMemoryItemStatement.run(nextDescription, nextContent, now, currentRow.id);
			updateMemoryStatement.run(
				parent.memory_type,
				parent.title,
				parent.description,
				now,
				currentRow.memory_id,
			);

			const row = getMemoryItemStatement.get(currentRow.id) as MemoryItemRow | undefined;
			if (!row) {
				throw new Error(`Failed to load updated memory item: ${currentRow.id}`);
			}

			return toStoredMemoryItem(row);
		},
		deleteMemory(memoryId) {
			const result = deleteMemoryStatement.run(memoryId.trim()) as { changes?: number };
			return (result.changes ?? 0) > 0;
		},
		deleteItem(itemId, memoryId) {
			const normalizedItemId = itemId.trim();
			const normalizedMemoryId = memoryId?.trim();
			const item = normalizedMemoryId
				? getMemoryItemForMemoryStatement.get(normalizedItemId, normalizedMemoryId)
				: getMemoryItemStatement.get(normalizedItemId);
			if (!item) {
				return false;
			}

			const itemRow = item as MemoryItemRow;
			const result = normalizedMemoryId
				? deleteMemoryItemForMemoryStatement.run(normalizedItemId, normalizedMemoryId)
				: deleteMemoryItemStatement.run(normalizedItemId);
			const changes = (result as { changes?: number }).changes ?? 0;
			if (changes > 0) {
				const parent = readExistingMemory(itemRow.memory_id);
				updateMemoryStatement.run(parent.memory_type, parent.title, parent.description, Date.now(), parent.id);
				return true;
			}

			return false;
		},
		renderAlwaysLoadedContext() {
			return renderAlwaysLoadedMemoryContext(this.listAll("always", ALWAYS_LOADED_MAX_MEMORIES));
		},
	};
}
