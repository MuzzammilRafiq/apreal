import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { createLogger } from "./logger.ts";
import type {
	SharedSessionState,
	TranscriptMessage,
	TranscriptMessageSegment,
	TranscriptToolCall,
} from "./web-session-state.ts";

const logger = createLogger("chat-store");
const require = createRequire(import.meta.url);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	busy INTEGER NOT NULL DEFAULT 0,
	model TEXT
);

CREATE TABLE IF NOT EXISTS messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	role TEXT NOT NULL,
	body TEXT NOT NULL DEFAULT '',
	thinking TEXT NOT NULL DEFAULT '',
	pending INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	segments_json TEXT NOT NULL DEFAULT '[]',
	tool_calls_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`;

type SessionRow = {
	id: string;
	title: string;
	created_at: number;
	updated_at: number;
	busy: number;
	model: string | null;
};

type MessageRow = {
	id: string;
	session_id: string;
	role: TranscriptMessage["role"];
	body: string;
	thinking: string;
	pending: number;
	created_at: number;
	segments_json: string;
	tool_calls_json: string;
};

type ChatStore = {
	loadSessions(): Map<string, SharedSessionState>;
	saveSession(session: SharedSessionState): void;
	deleteSession?(sessionId: string): void;
};

type SqliteModule = typeof import("node:sqlite");
type JsonRecord = Record<string, unknown>;

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function createNoopStore(): ChatStore {
	return {
		loadSessions() {
			return new Map();
		},
		saveSession() {},
	};
}

function isRole(value: unknown): value is TranscriptMessage["role"] {
	return value === "user" || value === "assistant" || value === "system" || value === "error";
}

function isToolStatus(value: unknown): value is TranscriptToolCall["status"] {
	return value === "running" || value === "completed" || value === "failed";
}

function isJsonRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null;
}

function normalizeTimestamp(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function parseJsonArray(raw: string, context: Record<string, string>): unknown[] {
	try {
		const value = JSON.parse(raw);
		if (Array.isArray(value)) {
			return value;
		}

		logger.warn("persisted JSON was not an array; using empty array", context);
		return [];
	} catch (error) {
		logger.error("failed to parse persisted JSON; using empty array", {
			...context,
			error: formatError(error),
		});
		return [];
	}
}

function decodeToolCalls(raw: string, messageId: string): TranscriptToolCall[] {
	const entries = parseJsonArray(raw, { messageId, field: "tool_calls_json" });
	const toolCalls: TranscriptToolCall[] = [];

	for (const entry of entries) {
		if (!isJsonRecord(entry)) {
			logger.warn("skipping malformed persisted tool call", { messageId });
			continue;
		}

		if (
			typeof entry.id !== "string" ||
			typeof entry.name !== "string" ||
			typeof entry.summary !== "string" ||
			!isToolStatus(entry.status)
		) {
			logger.warn("skipping malformed persisted tool call", { messageId });
			continue;
		}

		toolCalls.push({
			id: entry.id,
			name: entry.name,
			summary: entry.summary,
			status: entry.status,
			createdAt: normalizeTimestamp(entry.createdAt),
			updatedAt: normalizeTimestamp(entry.updatedAt),
		});
	}

	return toolCalls;
}

function decodeSegments(raw: string, messageId: string): TranscriptMessageSegment[] {
	const entries = parseJsonArray(raw, { messageId, field: "segments_json" });
	const segments: TranscriptMessageSegment[] = [];

	for (const entry of entries) {
		if (!isJsonRecord(entry) || typeof entry.type !== "string") {
			logger.warn("skipping malformed persisted segment", { messageId });
			continue;
		}

		if (entry.type === "text" || entry.type === "thinking") {
			if (typeof entry.id !== "string" || typeof entry.content !== "string") {
				logger.warn("skipping malformed persisted text/thinking segment", { messageId, type: entry.type });
				continue;
			}

			segments.push({
				id: entry.id,
				type: entry.type,
				content: entry.content,
				contentIndex: typeof entry.contentIndex === "number" ? entry.contentIndex : undefined,
				createdAt: normalizeTimestamp(entry.createdAt),
				updatedAt: normalizeTimestamp(entry.updatedAt),
			});
			continue;
		}

		if (entry.type === "tool_call") {
			if (
				typeof entry.id !== "string" ||
				typeof entry.name !== "string" ||
				typeof entry.summary !== "string" ||
				!isToolStatus(entry.status)
			) {
				logger.warn("skipping malformed persisted tool-call segment", { messageId });
				continue;
			}

			segments.push({
				id: entry.id,
				type: "tool_call",
				name: entry.name,
				summary: entry.summary,
				status: entry.status,
				contentIndex: typeof entry.contentIndex === "number" ? entry.contentIndex : undefined,
				createdAt: normalizeTimestamp(entry.createdAt),
				updatedAt: normalizeTimestamp(entry.updatedAt),
			});
			continue;
		}

		logger.warn("skipping persisted segment with unknown type", { messageId, type: entry.type });
	}

	return segments;
}

function runInTransaction(database: import("node:sqlite").DatabaseSync, callback: () => void) {
	database.exec("BEGIN");
	try {
		callback();
		database.exec("COMMIT");
	} catch (error) {
		try {
			database.exec("ROLLBACK");
		} catch (rollbackError) {
			logger.error("failed to roll back chat-store transaction", {
				error: formatError(rollbackError),
			});
		}
		throw error;
	}
}

export type { ChatStore };

export function createChatStore(dbPath: string): ChatStore {
	let sqlite: SqliteModule;
	try {
		sqlite = require("node:sqlite") as SqliteModule;
	} catch (error) {
		logger.error("node:sqlite is unavailable; chat persistence disabled", {
			dbPath,
			error: formatError(error),
		});
		return createNoopStore();
	}

	let database: import("node:sqlite").DatabaseSync;
	try {
		mkdirSync(dirname(dbPath), { recursive: true });
		database = new sqlite.DatabaseSync(dbPath, {
			enableForeignKeyConstraints: true,
			timeout: 1_000,
		});
		database.exec("PRAGMA foreign_keys = ON;");
		database.exec(SCHEMA_SQL);
	} catch (error) {
		logger.error("failed to initialize chat-store database; persistence disabled", {
			dbPath,
			error: formatError(error),
		});
		return createNoopStore();
	}

	const loadSessionsStatement = database.prepare(`
		SELECT id, title, created_at, updated_at, busy, model
		FROM sessions
		ORDER BY updated_at DESC, created_at DESC
	`);
	const loadMessagesStatement = database.prepare(`
		SELECT id, session_id, role, body, thinking, pending, created_at, segments_json, tool_calls_json
		FROM messages
		WHERE session_id = ?
		ORDER BY created_at ASC, id ASC
	`);
	const upsertSessionStatement = database.prepare(`
		INSERT INTO sessions (id, title, created_at, updated_at, busy, model)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			busy = excluded.busy,
			model = excluded.model
	`);
	const deleteMessagesStatement = database.prepare("DELETE FROM messages WHERE session_id = ?");
	const insertMessageStatement = database.prepare(`
		INSERT INTO messages (id, session_id, role, body, thinking, pending, created_at, segments_json, tool_calls_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	const deleteSessionStatement = database.prepare("DELETE FROM sessions WHERE id = ?");

	return {
		loadSessions() {
			try {
				const sessions = new Map<string, SharedSessionState>();
				const sessionRows = loadSessionsStatement.all() as SessionRow[];

				for (const sessionRow of sessionRows) {
					const transcript: TranscriptMessage[] = [];
					const toolCallMessageIds = new Map<string, string>();
					const messageRows = loadMessagesStatement.all(sessionRow.id) as MessageRow[];

					for (const messageRow of messageRows) {
						if (!isRole(messageRow.role)) {
							logger.warn("skipping persisted message with invalid role", {
								sessionId: sessionRow.id,
								messageId: messageRow.id,
							});
							continue;
						}

						const toolCalls = decodeToolCalls(messageRow.tool_calls_json, messageRow.id);
						const segments = decodeSegments(messageRow.segments_json, messageRow.id);
						const message: TranscriptMessage = {
							id: messageRow.id,
							role: messageRow.role,
							body: messageRow.body ?? "",
							thinking: messageRow.thinking ?? "",
							toolCalls,
							segments,
							pending: false,
							createdAt: normalizeTimestamp(messageRow.created_at),
						};

						for (const toolCall of toolCalls) {
							toolCallMessageIds.set(toolCall.id, message.id);
						}

						transcript.push(message);
					}

					sessions.set(sessionRow.id, {
						id: sessionRow.id,
						title: sessionRow.title,
						createdAt: normalizeTimestamp(sessionRow.created_at),
						updatedAt: normalizeTimestamp(sessionRow.updated_at),
						busy: false,
						abortRequested: false,
						model: sessionRow.model ?? null,
						controller: null,
						controllerPromise: null,
						unsubscribe: null,
						transcript,
						pendingAssistantMessageId: null,
						toolCallMessageIds,
					});
				}

				return sessions;
			} catch (error) {
				logger.error("failed to load persisted chat sessions", {
					dbPath,
					error: formatError(error),
				});
				return new Map();
			}
		},
		saveSession(session) {
			try {
				runInTransaction(database, () => {
					upsertSessionStatement.run(
						session.id,
						session.title,
						session.createdAt,
						session.updatedAt,
						session.busy ? 1 : 0,
						session.model,
					);
					deleteMessagesStatement.run(session.id);

					const transcript = [...session.transcript].sort(
						(left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
					);
					for (const message of transcript) {
						insertMessageStatement.run(
							message.id,
							session.id,
							message.role,
							message.body,
							message.thinking,
							message.pending ? 1 : 0,
							message.createdAt,
							JSON.stringify(message.segments ?? []),
							JSON.stringify(message.toolCalls ?? []),
						);
					}
				});
			} catch (error) {
				logger.error("failed to persist chat session", {
					sessionId: session.id,
					error: formatError(error),
				});
			}
		},
		deleteSession(sessionId) {
			try {
				deleteSessionStatement.run(sessionId);
			} catch (error) {
				logger.error("failed to delete persisted chat session", {
					sessionId,
					error: formatError(error),
				});
			}
		},
	};
}