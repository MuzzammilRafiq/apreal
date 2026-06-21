import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAprealAgentPath } from "./agent-dir.ts";

const MEMORY_DIR = getAprealAgentPath("memory");
const SEARCH_MEMORY_DIR = join(MEMORY_DIR, "search");
const ALWAYS_MEMORY_FILE = join(MEMORY_DIR, "always.md");
const AGENT_MEMORY_FILE = join(MEMORY_DIR, "MEMORY.md");
const USER_MEMORY_FILE = join(MEMORY_DIR, "USER.md");
const ALWAYS_MEMORY_VIRTUAL_PATH = "/virtual/APREAL_ALWAYS_MEMORY.md";
const SEARCH_MEMORY_INDEX_VIRTUAL_PATH = "/virtual/APREAL_SEARCH_MEMORY_INDEX.md";
const AGENT_MEMORY_VIRTUAL_PATH = "/virtual/APREAL_AGENT_MEMORY.md";
const USER_MEMORY_VIRTUAL_PATH = "/virtual/APREAL_USER_MEMORY.md";
const MAX_MEMORY_LINES = 50;
const MAX_SEARCH_MEMORY_FILES = 10;
const ENTRY_DELIMITER = "\n§\n";
const AGENT_MEMORY_CHAR_LIMIT = 2200;
const USER_MEMORY_CHAR_LIMIT = 1375;

export type MemoryKind = "always" | "search" | CuratedMemoryTarget;
export type CuratedMemoryTarget = "agent" | "user";

export type SearchMemoryFile = {
	fileName: string;
	lineCount: number;
	preview: string;
};

export type CuratedMemorySnapshot = {
	entries: string[];
	blockedEntries: number;
};

export type FileMemoryContext = {
	path: string;
	content: string;
};

export type FileMemoryPromptSnapshot = {
	always: string;
	searchFiles: SearchMemoryFile[];
	agent: CuratedMemorySnapshot;
	user: CuratedMemorySnapshot;
};

export interface FileMemoryStore {
	readAlways(): string;
	writeAlways(content: string): void;
	listSearchFiles(): SearchMemoryFile[];
	readSearch(fileName: string): string;
	writeSearch(fileName: string, content: string): void;
	deleteSearch(fileName: string): boolean;
	readCurated(target: CuratedMemoryTarget): string;
	listCurated(target: CuratedMemoryTarget): string[];
	writeCurated(target: CuratedMemoryTarget, content: string): void;
	addCurated(target: CuratedMemoryTarget, content: string): { index: number; count: number };
	replaceCurated(target: CuratedMemoryTarget, match: string, content: string): { index: number; count: number };
	removeCurated(target: CuratedMemoryTarget, match: string): { index: number; count: number };
	clearCurated(target: CuratedMemoryTarget): void;
	createPromptSnapshot(): FileMemoryPromptSnapshot;
	renderPromptContexts(snapshot: FileMemoryPromptSnapshot): FileMemoryContext[];
	renderAlwaysContext(): { path: string; content: string } | null;
	renderSearchIndexContext(): { path: string; content: string } | null;
}

function ensureMemoryDirs() {
	mkdirSync(SEARCH_MEMORY_DIR, { recursive: true });
	if (!existsSync(ALWAYS_MEMORY_FILE)) {
		writeFileSync(ALWAYS_MEMORY_FILE, "", "utf8");
	}
	if (!existsSync(AGENT_MEMORY_FILE)) {
		writeFileSync(AGENT_MEMORY_FILE, "", "utf8");
	}
	if (!existsSync(USER_MEMORY_FILE)) {
		writeFileSync(USER_MEMORY_FILE, "", "utf8");
	}
}

function countLines(content: string): number {
	if (!content) {
		return 0;
	}

	return content.replace(/\n$/, "").split(/\r?\n/).length;
}

function normalizeContent(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").trimEnd();
	if (countLines(normalized) > MAX_MEMORY_LINES) {
		throw new Error(`Memory files must be at most ${MAX_MEMORY_LINES} lines.`);
	}

	return `${normalized}\n`;
}

function normalizeSearchFileName(fileName: string): string {
	const normalized = basename(fileName.trim()).toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(normalized)) {
		throw new Error("Search memory filename must be kebab-case markdown, for example project-apreal.md.");
	}

	return normalized;
}

function getCuratedPath(target: CuratedMemoryTarget): string {
	return target === "agent" ? AGENT_MEMORY_FILE : USER_MEMORY_FILE;
}

function getCuratedCharLimit(target: CuratedMemoryTarget): number {
	return target === "agent" ? AGENT_MEMORY_CHAR_LIMIT : USER_MEMORY_CHAR_LIMIT;
}

function getCuratedLabel(target: CuratedMemoryTarget): string {
	return target === "agent" ? "Agent Memory" : "User Memory";
}

function parseCuratedEntries(content: string): string[] {
	return content
		.replace(/\r\n/g, "\n")
		.split(ENTRY_DELIMITER)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function renderCuratedEntries(entries: string[]): string {
	if (entries.length === 0) {
		return "";
	}

	return `${entries.join(ENTRY_DELIMITER)}\n`;
}

function totalCuratedChars(entries: string[]): number {
	return renderCuratedEntries(entries).length;
}

function assertCuratedWithinLimit(target: CuratedMemoryTarget, entries: string[]) {
	const limit = getCuratedCharLimit(target);
	const total = totalCuratedChars(entries);
	if (total > limit) {
		throw new Error(`${getCuratedLabel(target)} is limited to ${limit} characters. Consolidate or remove stale entries first.`);
	}
}

const STRICT_MEMORY_THREAT_PATTERNS = [
	/ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions/i,
	/(?:reveal|print|show|exfiltrate|leak).*(?:system|developer|prompt|secret|api\s*key|token)/i,
	/(?:system|developer)\s+prompt\s*:/i,
];

function firstThreatMessage(content: string): string | null {
	for (const pattern of STRICT_MEMORY_THREAT_PATTERNS) {
		if (pattern.test(content)) {
			return "Memory entry looks like prompt injection or secret-exfiltration content.";
		}
	}

	return null;
}

function normalizeCuratedEntry(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").trim();
	if (!normalized) {
		throw new Error("Memory entry content must be non-empty.");
	}
	if (normalized.includes("§")) {
		throw new Error("Memory entries cannot contain the § delimiter.");
	}

	const threat = firstThreatMessage(normalized);
	if (threat) {
		throw new Error(threat);
	}

	return normalized;
}

function normalizeCuratedFile(target: CuratedMemoryTarget, content: string): string {
	const entries = parseCuratedEntries(content).map(normalizeCuratedEntry);
	const deduped = [...new Set(entries)];
	assertCuratedWithinLimit(target, deduped);
	return renderCuratedEntries(deduped);
}

function findUniqueEntryIndex(entries: string[], match: string): number {
	const needle = match.trim();
	if (!needle) {
		throw new Error("match must be a non-empty substring of exactly one memory entry.");
	}

	const indexes = entries
		.map((entry, index) => entry.includes(needle) ? index : -1)
		.filter((index) => index >= 0);
	if (indexes.length === 0) {
		throw new Error("No memory entry matched that substring.");
	}
	if (indexes.length > 1) {
		throw new Error("More than one memory entry matched that substring. Use a more specific match.");
	}

	return indexes[0]!;
}

function readTextFile(path: string): string {
	if (!existsSync(path)) {
		return "";
	}

	return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function firstUsefulLine(content: string): string {
	for (const line of content.split(/\r?\n/)) {
		const normalized = line.replace(/^#+\s*/, "").trim();
		if (normalized) {
			return normalized;
		}
	}

	return "No content";
}

function listMarkdownFiles(): string[] {
	ensureMemoryDirs();
	return readdirSync(SEARCH_MEMORY_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
}

function renderSearchIndex(files: SearchMemoryFile[]): string {
	const lines = [
		"# Search Memory Index",
		"",
		"Only file names and compact previews are loaded here. Use the `memory` tool to read a search memory file when it is relevant.",
		"",
	];

	if (files.length === 0) {
		lines.push("- No search memory files yet.");
		return lines.join("\n");
	}

	for (const file of files) {
		lines.push(`- ${file.fileName}: ${file.preview} (${file.lineCount} line${file.lineCount === 1 ? "" : "s"})`);
	}

	return lines.join("\n");
}

function sanitizeCuratedSnapshot(entries: string[]): CuratedMemorySnapshot {
	const safeEntries: string[] = [];
	let blockedEntries = 0;
	for (const entry of entries) {
		const threat = firstThreatMessage(entry);
		if (threat) {
			blockedEntries += 1;
			safeEntries.push("[BLOCKED: memory entry contained a prompt-injection or secret-exfiltration pattern and was removed from the system prompt.]");
			continue;
		}

		safeEntries.push(entry);
	}

	return { entries: safeEntries, blockedEntries };
}

function renderCuratedContext(target: CuratedMemoryTarget, snapshot: CuratedMemorySnapshot): FileMemoryContext | null {
	if (snapshot.entries.length === 0 && snapshot.blockedEntries === 0) {
		return null;
	}

	const title = target === "agent" ? "Agent Memory" : "User Memory";
	const path = target === "agent" ? AGENT_MEMORY_VIRTUAL_PATH : USER_MEMORY_VIRTUAL_PATH;
	const description = target === "agent"
		? "Durable notes about Apreal, project conventions, environment facts, and workflow quirks."
		: "Durable notes about the user's preferences, communication style, and expectations.";
	const lines = [
		`# ${title}`,
		"Frozen snapshot loaded when this Apreal agent session was created.",
		description,
		"",
	];

	if (snapshot.entries.length === 0) {
		lines.push("- No entries yet.");
	} else {
		for (const entry of snapshot.entries) {
			lines.push(`- ${entry.replace(/\n/g, "\n  ")}`);
		}
	}

	return { path, content: lines.join("\n") };
}

let defaultFileMemoryStore: FileMemoryStore | null = null;

export function getDefaultFileMemoryStore(): FileMemoryStore {
	if (!defaultFileMemoryStore) {
		defaultFileMemoryStore = createFileMemoryStore();
	}

	return defaultFileMemoryStore;
}

export function createFileMemoryStore(): FileMemoryStore {
	ensureMemoryDirs();

	return {
		readAlways() {
			ensureMemoryDirs();
			return readTextFile(ALWAYS_MEMORY_FILE);
		},
		writeAlways(content) {
			ensureMemoryDirs();
			writeFileSync(ALWAYS_MEMORY_FILE, normalizeContent(content), "utf8");
		},
		listSearchFiles() {
			return listMarkdownFiles().map((fileName) => {
				const content = readTextFile(join(SEARCH_MEMORY_DIR, fileName));
				return {
					fileName,
					lineCount: countLines(content),
					preview: firstUsefulLine(content),
				};
			});
		},
		readSearch(fileName) {
			const normalized = normalizeSearchFileName(fileName);
			const path = join(SEARCH_MEMORY_DIR, normalized);
			if (!existsSync(path)) {
				throw new Error(`Search memory file not found: ${normalized}`);
			}

			return readTextFile(path);
		},
		writeSearch(fileName, content) {
			ensureMemoryDirs();
			const normalized = normalizeSearchFileName(fileName);
			const path = join(SEARCH_MEMORY_DIR, normalized);
			const exists = existsSync(path);
			if (!exists && listMarkdownFiles().length >= MAX_SEARCH_MEMORY_FILES) {
				throw new Error(`Search memory is limited to ${MAX_SEARCH_MEMORY_FILES} files. Update or delete an existing file first.`);
			}

			writeFileSync(path, normalizeContent(content), "utf8");
		},
		deleteSearch(fileName) {
			const normalized = normalizeSearchFileName(fileName);
			const path = join(SEARCH_MEMORY_DIR, normalized);
			if (!existsSync(path)) {
				return false;
			}

			rmSync(path);
			return true;
		},
		readCurated(target) {
			ensureMemoryDirs();
			return readTextFile(getCuratedPath(target));
		},
		listCurated(target) {
			ensureMemoryDirs();
			return parseCuratedEntries(readTextFile(getCuratedPath(target)));
		},
		writeCurated(target, content) {
			ensureMemoryDirs();
			writeFileSync(getCuratedPath(target), normalizeCuratedFile(target, content), "utf8");
		},
		addCurated(target, content) {
			ensureMemoryDirs();
			const entries = parseCuratedEntries(readTextFile(getCuratedPath(target)));
			const entry = normalizeCuratedEntry(content);
			if (!entries.includes(entry)) {
				entries.push(entry);
			}
			assertCuratedWithinLimit(target, entries);
			writeFileSync(getCuratedPath(target), renderCuratedEntries(entries), "utf8");
			return { index: entries.indexOf(entry), count: entries.length };
		},
		replaceCurated(target, match, content) {
			ensureMemoryDirs();
			const entries = parseCuratedEntries(readTextFile(getCuratedPath(target)));
			const index = findUniqueEntryIndex(entries, match);
			entries[index] = normalizeCuratedEntry(content);
			const deduped = [...new Set(entries)];
			assertCuratedWithinLimit(target, deduped);
			writeFileSync(getCuratedPath(target), renderCuratedEntries(deduped), "utf8");
			return { index, count: deduped.length };
		},
		removeCurated(target, match) {
			ensureMemoryDirs();
			const entries = parseCuratedEntries(readTextFile(getCuratedPath(target)));
			const index = findUniqueEntryIndex(entries, match);
			entries.splice(index, 1);
			writeFileSync(getCuratedPath(target), renderCuratedEntries(entries), "utf8");
			return { index, count: entries.length };
		},
		clearCurated(target) {
			ensureMemoryDirs();
			writeFileSync(getCuratedPath(target), "", "utf8");
		},
		createPromptSnapshot() {
			ensureMemoryDirs();
			return {
				always: this.readAlways(),
				searchFiles: this.listSearchFiles(),
				agent: sanitizeCuratedSnapshot(this.listCurated("agent")),
				user: sanitizeCuratedSnapshot(this.listCurated("user")),
			};
		},
		renderPromptContexts(snapshot) {
			const contexts: FileMemoryContext[] = [];
			const alwaysContent = snapshot.always.trim();
			if (alwaysContent) {
				contexts.push({
					path: ALWAYS_MEMORY_VIRTUAL_PATH,
					content: ["# Always Memory", "Frozen snapshot loaded when this Apreal agent session was created.", "", alwaysContent].join("\n"),
				});
			}

			contexts.push({
				path: SEARCH_MEMORY_INDEX_VIRTUAL_PATH,
				content: renderSearchIndex(snapshot.searchFiles),
			});

			const agentContext = renderCuratedContext("agent", snapshot.agent);
			if (agentContext) {
				contexts.push(agentContext);
			}

			const userContext = renderCuratedContext("user", snapshot.user);
			if (userContext) {
				contexts.push(userContext);
			}

			return contexts;
		},
		renderAlwaysContext() {
			const content = this.readAlways().trim();
			if (!content) {
				return null;
			}

			return {
				path: ALWAYS_MEMORY_VIRTUAL_PATH,
				content: ["# Always Memory", "Loaded at the start of every Apreal session.", "", content].join("\n"),
			};
		},
		renderSearchIndexContext() {
			return {
				path: SEARCH_MEMORY_INDEX_VIRTUAL_PATH,
				content: renderSearchIndex(this.listSearchFiles()),
			};
		},
	};
}
