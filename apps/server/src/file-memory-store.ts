import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAprealAgentPath } from "./agent-dir.ts";

const MEMORY_DIR = getAprealAgentPath("memory");
const SEARCH_MEMORY_DIR = join(MEMORY_DIR, "search");
const ALWAYS_MEMORY_FILE = join(MEMORY_DIR, "always.md");
const ALWAYS_MEMORY_VIRTUAL_PATH = "/virtual/APREAL_ALWAYS_MEMORY.md";
const SEARCH_MEMORY_INDEX_VIRTUAL_PATH = "/virtual/APREAL_SEARCH_MEMORY_INDEX.md";
const MAX_MEMORY_LINES = 50;
const MAX_SEARCH_MEMORY_FILES = 10;

export type MemoryKind = "always" | "search";

export type SearchMemoryFile = {
	fileName: string;
	lineCount: number;
	preview: string;
};

export interface FileMemoryStore {
	readAlways(): string;
	writeAlways(content: string): void;
	listSearchFiles(): SearchMemoryFile[];
	readSearch(fileName: string): string;
	writeSearch(fileName: string, content: string): void;
	deleteSearch(fileName: string): boolean;
	renderAlwaysContext(): { path: string; content: string } | null;
	renderSearchIndexContext(): { path: string; content: string } | null;
}

function ensureMemoryDirs() {
	mkdirSync(SEARCH_MEMORY_DIR, { recursive: true });
	if (!existsSync(ALWAYS_MEMORY_FILE)) {
		writeFileSync(ALWAYS_MEMORY_FILE, "", "utf8");
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
