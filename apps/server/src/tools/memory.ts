import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { CuratedMemoryTarget, FileMemoryStore, MemoryKind } from "../file-memory-store.ts";

const memoryToolParameters = Type.Object({
	action: Type.Union([
		Type.Literal("add"),
		Type.Literal("list"),
		Type.Literal("read"),
		Type.Literal("remove"),
		Type.Literal("replace"),
		Type.Literal("write"),
		Type.Literal("forget"),
	]),
	memoryType: Type.Union([
		Type.Literal("always"),
		Type.Literal("search"),
		Type.Literal("agent"),
		Type.Literal("user"),
	]),
	fileName: Type.Optional(Type.String({
		description: "Search memory filename. Required for reading, writing, or forgetting search memory. Must be kebab-case markdown, for example project-apreal.md.",
	})),
	match: Type.Optional(Type.String({
		description: "A short unique substring of one agent/user memory entry. Required for replace and remove.",
	})),
	content: Type.Optional(Type.String({
		description: "Memory content. For agent/user add and replace, this is one durable entry. For write, this is complete Markdown content.",
	})),
});

type MemoryToolParams = Static<typeof memoryToolParameters>;
type MemoryAction = "add" | "list" | "read" | "remove" | "replace" | "write" | "forget";

function readRequiredContent(content: string | undefined): string {
	if (typeof content !== "string" || !content.trim()) {
		throw new Error("content must be a non-empty Markdown string.");
	}

	return content;
}

function readRequiredFileName(fileName: string | undefined): string {
	const normalized = fileName?.trim();
	if (!normalized) {
		throw new Error("fileName is required for search memory.");
	}

	return normalized;
}

function readRequiredMatch(match: string | undefined): string {
	const normalized = match?.trim();
	if (!normalized) {
		throw new Error("match is required for replace/remove on agent or user memory.");
	}

	return normalized;
}

function countLines(content: string): number {
	if (!content) {
		return 0;
	}

	return content.replace(/\n$/, "").split(/\r?\n/).length;
}

function isCuratedMemoryKind(memoryType: MemoryKind): memoryType is CuratedMemoryTarget {
	return memoryType === "agent" || memoryType === "user";
}

function buildDetails(input: {
	action: MemoryAction;
	memoryType: MemoryKind;
	fileName?: string | null;
	count?: number | null;
	entryIndex?: number | null;
	lineCount?: number | null;
}) {
	return {
		action: input.action,
		memoryType: input.memoryType,
		fileName: input.fileName ?? null,
		count: input.count ?? null,
		entryIndex: input.entryIndex ?? null,
		lineCount: input.lineCount ?? null,
	};
}

export function createMemoryTool(store: FileMemoryStore) {
	return defineTool({
		name: "memory",
		label: "Memory",
		description:
			"Manages Apreal persistent memory. Prefer agent/user memory for durable curated entries: user stores the user's preferences and expectations; agent stores project, environment, and workflow facts. Use add for new entries, replace/remove with a short unique match to keep memory compact. Legacy always/search Markdown memory is still available: always is loaded at session start, search is up to 10 topic files read on demand.",
		parameters: memoryToolParameters as any,
		async execute(_toolCallId, params: MemoryToolParams) {
			switch (params.action) {
				case "add": {
					if (!isCuratedMemoryKind(params.memoryType)) {
						throw new Error("add is only supported for agent or user memory.");
					}
					const content = readRequiredContent(params.content);
					const result = store.addCurated(params.memoryType, content);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "add",
										memoryType: params.memoryType,
										entryIndex: result.index,
										count: result.count,
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "add",
							memoryType: params.memoryType,
							count: result.count,
							entryIndex: result.index,
						}),
					};
				}
				case "list": {
					if (params.memoryType === "always") {
						const content = store.readAlways();
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											action: "list",
											memoryType: "always",
											fileName: "always.md",
											lineCount: countLines(content),
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "list",
								memoryType: "always",
								fileName: "always.md",
								lineCount: countLines(content),
							}),
						};
					}
					if (isCuratedMemoryKind(params.memoryType)) {
						const entries = store.listCurated(params.memoryType);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											action: "list",
											memoryType: params.memoryType,
											count: entries.length,
											entries,
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "list",
								memoryType: params.memoryType,
								count: entries.length,
							}),
						};
					}

					const files = store.listSearchFiles();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										action: "list",
										memoryType: "search",
										count: files.length,
										files,
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "list",
							memoryType: "search",
							count: files.length,
						}),
					};
				}
				case "read": {
					if (params.memoryType === "always") {
						const content = store.readAlways();
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											action: "read",
											memoryType: "always",
											fileName: "always.md",
											lineCount: countLines(content),
											content,
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "read",
								memoryType: "always",
								fileName: "always.md",
								lineCount: countLines(content),
							}),
						};
					}
					if (isCuratedMemoryKind(params.memoryType)) {
						const content = store.readCurated(params.memoryType);
						const entries = store.listCurated(params.memoryType);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											action: "read",
											memoryType: params.memoryType,
											count: entries.length,
											content,
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "read",
								memoryType: params.memoryType,
								count: entries.length,
								lineCount: countLines(content),
							}),
						};
					}

					const fileName = readRequiredFileName(params.fileName);
					const content = store.readSearch(fileName);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										action: "read",
										memoryType: "search",
										fileName,
										lineCount: countLines(content),
										content,
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "read",
							memoryType: "search",
							fileName,
							lineCount: countLines(content),
						}),
					};
				}
				case "replace": {
					if (!isCuratedMemoryKind(params.memoryType)) {
						throw new Error("replace is only supported for agent or user memory.");
					}
					const match = readRequiredMatch(params.match);
					const content = readRequiredContent(params.content);
					const result = store.replaceCurated(params.memoryType, match, content);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "replace",
										memoryType: params.memoryType,
										entryIndex: result.index,
										count: result.count,
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "replace",
							memoryType: params.memoryType,
							count: result.count,
							entryIndex: result.index,
						}),
					};
				}
				case "remove": {
					if (!isCuratedMemoryKind(params.memoryType)) {
						throw new Error("remove is only supported for agent or user memory.");
					}
					const match = readRequiredMatch(params.match);
					const result = store.removeCurated(params.memoryType, match);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "remove",
										memoryType: params.memoryType,
										entryIndex: result.index,
										count: result.count,
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "remove",
							memoryType: params.memoryType,
							count: result.count,
							entryIndex: result.index,
						}),
					};
				}
				case "write": {
					const content = readRequiredContent(params.content);
					if (params.memoryType === "always") {
						store.writeAlways(content);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: true,
											action: "write",
											memoryType: "always",
											fileName: "always.md",
											lineCount: countLines(content),
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "write",
								memoryType: "always",
								fileName: "always.md",
								lineCount: countLines(content),
							}),
						};
					}
					if (isCuratedMemoryKind(params.memoryType)) {
						store.writeCurated(params.memoryType, content);
						const entries = store.listCurated(params.memoryType);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: true,
											action: "write",
											memoryType: params.memoryType,
											count: entries.length,
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "write",
								memoryType: params.memoryType,
								count: entries.length,
							}),
						};
					}

					const fileName = readRequiredFileName(params.fileName);
					store.writeSearch(fileName, content);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "write",
										memoryType: "search",
										fileName,
										lineCount: countLines(content),
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "write",
							memoryType: "search",
							fileName,
							lineCount: countLines(content),
						}),
					};
				}
				case "forget": {
					if (params.memoryType === "always") {
						store.writeAlways("");
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: true,
											action: "forget",
											memoryType: "always",
											fileName: "always.md",
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "forget",
								memoryType: "always",
								fileName: "always.md",
							}),
						};
					}
					if (isCuratedMemoryKind(params.memoryType)) {
						store.clearCurated(params.memoryType);
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: true,
											action: "forget",
											memoryType: params.memoryType,
											count: 0,
										},
										null,
										2,
									),
								},
							],
							details: buildDetails({
								action: "forget",
								memoryType: params.memoryType,
								count: 0,
							}),
						};
					}

					const fileName = readRequiredFileName(params.fileName);
					if (!store.deleteSearch(fileName)) {
						throw new Error(`Search memory file not found: ${fileName}`);
					}

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										action: "forget",
										memoryType: "search",
										fileName,
									},
									null,
									2,
								),
							},
						],
						details: buildDetails({
							action: "forget",
							memoryType: "search",
							fileName,
						}),
					};
				}
			}
		},
	});
}
