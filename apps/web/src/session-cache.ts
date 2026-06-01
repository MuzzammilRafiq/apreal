import type { SessionSummary, TranscriptMessage } from "./chatTypes";

const DATABASE_NAME = "apreal-chat-cache";
const DATABASE_VERSION = 1;
const SESSION_SUMMARIES_STORE = "session_summaries";
const SESSION_TRANSCRIPTS_STORE = "session_transcripts";

type SessionTranscriptRecord = {
	sessionId: string;
	session: SessionSummary;
	transcript: TranscriptMessage[];
	cachedAt: number;
};

function hasIndexedDb(): boolean {
	return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase | null> {
	if (!hasIndexedDb()) {
		return Promise.resolve(null);
	}

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onerror = () => {
			reject(request.error ?? new Error("Failed to open browser cache."));
		};
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(SESSION_SUMMARIES_STORE)) {
				database.createObjectStore(SESSION_SUMMARIES_STORE, { keyPath: "id" });
			}
			if (!database.objectStoreNames.contains(SESSION_TRANSCRIPTS_STORE)) {
				database.createObjectStore(SESSION_TRANSCRIPTS_STORE, { keyPath: "sessionId" });
			}
		};
		request.onsuccess = () => {
			resolve(request.result);
		};
	});
}

function runReadonlyTransaction<T>(
	database: IDBDatabase,
	storeName: string,
	executor: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error: unknown) => void) => void,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(storeName, "readonly");
		transaction.onerror = () => {
			reject(transaction.error ?? new Error("Browser cache read failed."));
		};
		executor(transaction.objectStore(storeName), resolve, reject);
	});
}

function runReadwriteTransaction(
	database: IDBDatabase,
	storeNames: string[],
	executor: (transaction: IDBTransaction) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(storeNames, "readwrite");
		transaction.onerror = () => {
			reject(transaction.error ?? new Error("Browser cache write failed."));
		};
		transaction.oncomplete = () => {
			resolve();
		};
		executor(transaction);
	});
}

export async function readCachedSessionSummaries(): Promise<SessionSummary[]> {
	const database = await openDatabase();
	if (!database) {
		return [];
	}

	const sessions = await runReadonlyTransaction<SessionSummary[]>(database, SESSION_SUMMARIES_STORE, (store, resolve, reject) => {
		const request = store.getAll();
		request.onerror = () => {
			reject(request.error ?? new Error("Failed to read cached session summaries."));
		};
		request.onsuccess = () => {
			resolve((request.result as SessionSummary[]).sort((left, right) => right.updatedAt - left.updatedAt));
		};
	});
	database.close();
	return sessions;
}

export async function readCachedSessionSnapshot(
	sessionId: string,
): Promise<{ session: SessionSummary; transcript: TranscriptMessage[] } | null> {
	const database = await openDatabase();
	if (!database) {
		return null;
	}

	const record = await runReadonlyTransaction<SessionTranscriptRecord | null>(
		database,
		SESSION_TRANSCRIPTS_STORE,
		(store, resolve, reject) => {
			const request = store.get(sessionId);
			request.onerror = () => {
				reject(request.error ?? new Error("Failed to read cached session transcript."));
			};
			request.onsuccess = () => {
				resolve((request.result as SessionTranscriptRecord | undefined) ?? null);
			};
		},
	);
	database.close();
	if (!record) {
		return null;
	}

	return {
		session: record.session,
		transcript: record.transcript,
	};
}

export async function writeSessionSummaries(sessions: SessionSummary[]): Promise<void> {
	if (sessions.length === 0) {
		return;
	}

	const database = await openDatabase();
	if (!database) {
		return;
	}

	await runReadwriteTransaction(database, [SESSION_SUMMARIES_STORE], (transaction) => {
		const store = transaction.objectStore(SESSION_SUMMARIES_STORE);
		for (const session of sessions) {
			store.put(session);
		}
	});
	database.close();
}

export async function writeSessionSummary(session: SessionSummary): Promise<void> {
	await writeSessionSummaries([session]);
}

export async function writeSessionSnapshot(session: SessionSummary, transcript: TranscriptMessage[]): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		return;
	}

	await runReadwriteTransaction(database, [SESSION_SUMMARIES_STORE, SESSION_TRANSCRIPTS_STORE], (transaction) => {
		transaction.objectStore(SESSION_SUMMARIES_STORE).put(session);
		transaction.objectStore(SESSION_TRANSCRIPTS_STORE).put({
			sessionId: session.id,
			session,
			transcript,
			cachedAt: Date.now(),
		} satisfies SessionTranscriptRecord);
	});
	database.close();
}

export async function deleteCachedSession(sessionId: string): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		return;
	}

	await runReadwriteTransaction(database, [SESSION_SUMMARIES_STORE, SESSION_TRANSCRIPTS_STORE], (transaction) => {
		transaction.objectStore(SESSION_SUMMARIES_STORE).delete(sessionId);
		transaction.objectStore(SESSION_TRANSCRIPTS_STORE).delete(sessionId);
	});
	database.close();
}

export async function clearCachedSessions(): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		return;
	}

	await runReadwriteTransaction(database, [SESSION_SUMMARIES_STORE, SESSION_TRANSCRIPTS_STORE], (transaction) => {
		transaction.objectStore(SESSION_SUMMARIES_STORE).clear();
		transaction.objectStore(SESSION_TRANSCRIPTS_STORE).clear();
	});
	database.close();
}
