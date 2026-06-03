import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { FileMemoryStore, MemoryKind } from "../file-memory-store.ts";

const memoryToolParameters = Type.Object({
	action: Type.Union([
		Type.Literal("list"),
		Type.Literal("read"),
		Type.Literal("write"),
		Type.Literal("forget"),
	]),
	memoryType: Type.Union([
		Type.Literal("always"),
		Type.Literal("search"),
	]),
	fileName: Type.Optional(Type.String({
		description: "Search memory filename. Required for reading, writing, or forgetting search memory. Must be kebab-case markdown, for example project-apreal.md.",
	})),
	content: Type.Optional(Type.String({
		description: "Complete Markdown content to write. Memory files must be at most 50 lines.",
	})),
});

type MemoryToolParams = Static<typeof memoryToolParameters>;
type MemoryAction = "list" | "read" | "write" | "forget";

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

function countLines(content: string): number {
	if (!content) {
		return 0;
	}

	return content.replace(/\n$/, "").split(/\r?\n/).length;
}

function buildDetails(input: {
	action: MemoryAction;
	memoryType: MemoryKind;
	fileName?: string | null;
	count?: number | null;
	lineCount?: number | null;
}) {
	return {
		action: input.action,
		memoryType: input.memoryType,
		fileName: input.fileName ?? null,
		count: input.count ?? null,
		lineCount: input.lineCount ?? null,
	};
}

export function createMemoryTool(store: FileMemoryStore) {
	return defineTool({
		name: "memory",
		label: "Memory",
		description:
			"Manages Apreal Markdown memory files. Use always memory for the single always-loaded file, and search memory for up to 10 topic files that are read on demand. Every memory file must stay under 50 lines.",
		parameters: memoryToolParameters as any,
		async execute(_toolCallId, params: MemoryToolParams) {
			switch (params.action) {
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
