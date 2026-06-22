import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Type, type Static } from "@earendil-works/pi-ai";
import {
	DefaultResourceLoader,
	SettingsManager,
	defineTool,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import { getAprealAgentDir, getAprealAgentPath } from "../agent-dir.ts";

const SUPPORTING_FILE_DIRS = ["references", "templates", "scripts", "assets"] as const;
const MAX_SKILL_FILE_BYTES = 256_000;

const skillsListParameters = Type.Object({
	query: Type.Optional(Type.String({
		description: "Optional case-insensitive text filter matched against skill name, description, source, and location.",
	})),
	source: Type.Optional(Type.Union([
		Type.Literal("project"),
		Type.Literal("user"),
		Type.Literal("extension"),
		Type.Literal("temporary"),
		Type.Literal("path"),
	], {
		description: "Optional source filter.",
	})),
});

const skillViewParameters = Type.Object({
	name: Type.String({
		description: "Skill name to load. Use skills_list first if you are unsure.",
	}),
	filePath: Type.Optional(Type.String({
		description: "Optional supporting file path inside the skill directory, for example references/api.md or scripts/validate.ts. Omit to read SKILL.md.",
	})),
});

const skillManageParameters = Type.Object({
	action: Type.Union([
		Type.Literal("create"),
		Type.Literal("patch"),
		Type.Literal("write_file"),
		Type.Literal("delete"),
	]),
	name: Type.String({
		description: "Lowercase kebab-case skill name.",
	}),
	description: Type.Optional(Type.String({
		description: "Short skill description. Required when creating a skill; optional when patching SKILL.md.",
	})),
	content: Type.Optional(Type.String({
		description: "For create/patch, the main SKILL.md instructions body or a complete SKILL.md. For write_file, the full file content.",
	})),
	filePath: Type.Optional(Type.String({
		description: "Required for write_file. Must be under references/, templates/, scripts/, or assets/ within the local skill directory.",
	})),
	overwrite: Type.Optional(Type.Boolean({
		description: "For create, allow replacing an existing local skill with the same name.",
	})),
});

type SkillsListParams = Static<typeof skillsListParameters>;
type SkillViewParams = Static<typeof skillViewParameters>;
type SkillManageParams = Static<typeof skillManageParameters>;
type SkillSource = "project" | "user" | "extension" | "temporary" | "path";
type SkillManageAction = "create" | "patch" | "write_file" | "delete";

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return { frontmatter: {}, body: normalized };
	}

	const endIndex = normalized.indexOf("\n---", 4);
	if (endIndex === -1) {
		return { frontmatter: {}, body: normalized };
	}

	const rawFrontmatter = normalized.slice(4, endIndex);
	const bodyStart = normalized.slice(endIndex).startsWith("\n---\n") ? endIndex + 5 : endIndex + 4;
	const frontmatter: Record<string, string> = {};
	for (const line of rawFrontmatter.split("\n")) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
		if (!match) {
			continue;
		}
		frontmatter[match[1]!] = unquoteYamlScalar(match[2] ?? "");
	}

	return {
		frontmatter,
		body: normalized.slice(bodyStart).replace(/^\n+/, ""),
	};
}

function unquoteYamlScalar(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function quoteYamlScalar(value: string): string {
	return JSON.stringify(value.trim());
}

function stripFrontmatter(content: string): string {
	return parseFrontmatter(content).body.trim();
}

function normalizeSkillName(name: string): string {
	const normalized = name.trim().toLowerCase();
	if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(normalized) || normalized.includes("--")) {
		throw new Error("Skill name must be lowercase kebab-case, 1-64 chars, with no leading/trailing/consecutive hyphens.");
	}
	return normalized;
}

function readRequired(value: string | undefined, label: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${label} is required.`);
	}
	return normalized;
}

function localSkillsDir(): string {
	return getAprealAgentPath("skills");
}

function localSkillDir(name: string): string {
	return join(localSkillsDir(), normalizeSkillName(name));
}

function isUnderPath(targetPath: string, rootPath: string): boolean {
	const target = resolve(targetPath);
	const root = resolve(rootPath);
	if (target === root) {
		return true;
	}
	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
	return target.startsWith(prefix);
}

function getSource(skill: Skill): SkillSource {
	const sourceInfo = skill.sourceInfo;
	if (sourceInfo.origin === "package") {
		return "extension";
	}
	if (sourceInfo.scope === "project") {
		return "project";
	}
	if (sourceInfo.scope === "user") {
		return "user";
	}
	if (sourceInfo.scope === "temporary") {
		return "temporary";
	}
	return "path";
}

async function loadSkills(cwd: string): Promise<Skill[]> {
	const agentDir = getAprealAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
	});
	await resourceLoader.reload();
	return resourceLoader.getSkills().skills;
}

function findSkill(skills: Skill[], requestedName: string): Skill {
	const normalized = requestedName.trim();
	const exact = skills.find((skill) => skill.name === normalized);
	if (exact) {
		return exact;
	}

	const lower = normalized.toLowerCase();
	const caseInsensitive = skills.filter((skill) => skill.name.toLowerCase() === lower);
	if (caseInsensitive.length === 1) {
		return caseInsensitive[0]!;
	}

	throw new Error(`Skill not found: ${requestedName}. Use skills_list to see available skills.`);
}

function listSupportingFiles(skillDir: string): Record<string, string[]> {
	const linkedFiles: Record<string, string[]> = {};
	for (const dirName of SUPPORTING_FILE_DIRS) {
		const dirPath = join(skillDir, dirName);
		if (!existsSync(dirPath)) {
			continue;
		}
		const files = walkFiles(dirPath)
			.map((path) => relative(skillDir, path).split(sep).join("/"))
			.sort((left, right) => left.localeCompare(right));
		if (files.length > 0) {
			linkedFiles[dirName] = files;
		}
	}
	return linkedFiles;
}

function walkFiles(dirPath: string): string[] {
	const entries = readdirSync(dirPath, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		const path = join(dirPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(path));
			continue;
		}
		if (entry.isFile()) {
			files.push(path);
		}
	}
	return files;
}

function resolveSkillFile(skill: Skill, filePath: string | undefined): { path: string; relativePath: string } {
	if (!filePath?.trim()) {
		return { path: skill.filePath, relativePath: basename(skill.filePath) };
	}

	const normalizedRelative = filePath.trim().replace(/^\/+/, "");
	const resolved = resolve(skill.baseDir, normalizedRelative);
	if (!isUnderPath(resolved, skill.baseDir)) {
		throw new Error("filePath must stay inside the skill directory.");
	}
	const resolvedRelative = relative(skill.baseDir, resolved).split(sep).join("/");
	const firstSegment = resolvedRelative.split("/")[0];
	if (!SUPPORTING_FILE_DIRS.includes(firstSegment as (typeof SUPPORTING_FILE_DIRS)[number])) {
		throw new Error("filePath must point to a supporting file under references/, templates/, scripts/, or assets/.");
	}
	if (!existsSync(resolved) || !statSync(resolved).isFile()) {
		throw new Error(`Skill supporting file not found: ${normalizedRelative}`);
	}
	return {
		path: resolved,
		relativePath: resolvedRelative,
	};
}

function readSkillText(filePath: string): string {
	const stats = statSync(filePath);
	if (stats.size > MAX_SKILL_FILE_BYTES) {
		throw new Error(`Skill file is too large to load safely (${stats.size} bytes).`);
	}
	return readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function renderSkillMarkdown(name: string, description: string, content: string): string {
	const trimmed = content.replace(/\r\n/g, "\n").trim();
	if (trimmed.startsWith("---\n")) {
		return `${trimmed}\n`;
	}
	return [
		"---",
		`name: ${quoteYamlScalar(normalizeSkillName(name))}`,
		`description: ${quoteYamlScalar(description)}`,
		"---",
		"",
		trimmed,
		"",
	].join("\n");
}

function ensureLocalMutableSkill(name: string): string {
	const dir = localSkillDir(name);
	const mainFile = join(dir, "SKILL.md");
	if (!existsSync(mainFile)) {
		throw new Error(`Local Apreal skill not found: ${name}. Only skills under ${localSkillsDir()} can be modified with skill_manage.`);
	}
	return dir;
}

function resolveWritableSupportingFile(name: string, filePath: string | undefined): { path: string; relativePath: string } {
	const requested = readRequired(filePath, "filePath").replace(/^\/+/, "");
	if (requested === "SKILL.md" || requested.endsWith("/SKILL.md")) {
		throw new Error("Use action=patch to update SKILL.md.");
	}
	const firstSegment = requested.split("/")[0];
	if (!SUPPORTING_FILE_DIRS.includes(firstSegment as (typeof SUPPORTING_FILE_DIRS)[number])) {
		throw new Error("filePath must begin with references/, templates/, scripts/, or assets/.");
	}

	const skillDir = ensureLocalMutableSkill(name);
	const resolved = resolve(skillDir, requested);
	if (!isUnderPath(resolved, skillDir)) {
		throw new Error("filePath must stay inside the skill directory.");
	}
	return {
		path: resolved,
		relativePath: relative(skillDir, resolved).split(sep).join("/"),
	};
}

function buildToolText(payload: unknown): { content: [{ type: "text"; text: string }] } {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(payload, null, 2),
			},
		],
	};
}

function buildDetails(details: Record<string, unknown>): Record<string, unknown> {
	return details;
}

export function createSkillsListTool(cwd = process.cwd()) {
	return defineTool({
		name: "skills_list",
		label: "Skills List",
		description: "List available Apreal skills by name, description, source, and location. Use skill_view to load full instructions before applying a skill.",
		promptSnippet: "Lists available Apreal skills. Use this before skill_view when you need specialized workflow instructions.",
		parameters: skillsListParameters as any,
		executionMode: "parallel",
		async execute(_toolCallId, params: SkillsListParams) {
			const skills = await loadSkills(cwd);
			const query = params.query?.trim().toLowerCase();
			const entries = skills
				.map((skill) => ({
					name: skill.name,
					description: skill.description,
					source: getSource(skill),
					location: skill.filePath,
					skillDir: skill.baseDir,
					disableModelInvocation: skill.disableModelInvocation,
				}))
				.filter((skill) => !params.source || skill.source === params.source)
				.filter((skill) => {
					if (!query) {
						return true;
					}
					return [skill.name, skill.description, skill.source, skill.location]
						.some((value) => value.toLowerCase().includes(query));
				})
				.sort((left, right) => left.name.localeCompare(right.name));

			return {
				...buildToolText({
					success: true,
					count: entries.length,
					skills: entries,
					hint: "Call skill_view(name) to load full instructions and supporting file paths.",
				}),
				details: { count: entries.length, query: params.query ?? null, source: params.source ?? null },
			};
		},
	});
}

export function createSkillViewTool(cwd = process.cwd()) {
	return defineTool({
		name: "skill_view",
		label: "Skill View",
		description: "Load a skill's full SKILL.md instructions or a supporting file from references/, templates/, scripts/, or assets/.",
		promptSnippet: "Loads full Apreal skill instructions or supporting files.",
		parameters: skillViewParameters as any,
		executionMode: "parallel",
		async execute(_toolCallId, params: SkillViewParams) {
			const skills = await loadSkills(cwd);
			const skill = findSkill(skills, params.name);
			const target = resolveSkillFile(skill, params.filePath);
			const rawContent = readSkillText(target.path);
			const isMainSkillFile = target.path === skill.filePath;
			const content = isMainSkillFile ? stripFrontmatter(rawContent) : rawContent;
			const linkedFiles = isMainSkillFile ? listSupportingFiles(skill.baseDir) : undefined;

			return {
				...buildToolText({
					success: true,
					name: skill.name,
					description: skill.description,
					source: getSource(skill),
					path: target.path,
					relativePath: target.relativePath,
					skillDir: skill.baseDir,
					content,
					...(linkedFiles ? {
						linkedFiles,
						usageHint: "To view a linked file, call skill_view with the same name and filePath set to one of these relative paths. Resolve relative paths in the skill against skillDir.",
					} : {}),
				}),
				details: { name: skill.name, filePath: params.filePath ?? null },
			};
		},
	});
}

export function createSkillManageTool() {
	return defineTool({
		name: "skill_manage",
		label: "Skill Manage",
		description: "Create and maintain local Apreal skills in ~/.apreal/agent/skills. Use after difficult or repeatable workflows so future sessions can reuse the procedure. Mutates only local Apreal skills; use skill_view before patching.",
		promptSnippet: "Creates or updates local Apreal skills for durable workflow knowledge.",
		promptGuidelines: [
			"Use memory for stable facts and preferences; use skill_manage for reusable procedures, troubleshooting playbooks, commands, and workflows.",
			"After complex or iterative work, consider creating or patching a local skill if the workflow is likely to recur.",
			"Before patching a skill, read it with skill_view and provide the complete updated SKILL.md body/content.",
		],
		parameters: skillManageParameters as any,
		executionMode: "sequential",
		async execute(_toolCallId, params: SkillManageParams) {
			const action = params.action as SkillManageAction;
			const name = normalizeSkillName(params.name);
			switch (action) {
				case "create": {
					const description = readRequired(params.description, "description");
					const content = readRequired(params.content, "content");
					const dir = localSkillDir(name);
					const mainFile = join(dir, "SKILL.md");
					if (existsSync(mainFile) && !params.overwrite) {
						throw new Error(`Local skill already exists: ${name}. Use overwrite=true or action=patch.`);
					}
					mkdirSync(dir, { recursive: true });
					writeFileSync(mainFile, renderSkillMarkdown(name, description, content), "utf8");
					return {
						...buildToolText({
							success: true,
							action,
							name,
							path: mainFile,
							hint: "The skill is saved locally. Use skill_view to load it in future tasks.",
						}),
						details: buildDetails({ action, name, path: mainFile }),
					};
				}
				case "patch": {
					const content = readRequired(params.content, "content");
					const dir = ensureLocalMutableSkill(name);
					const mainFile = join(dir, "SKILL.md");
					const existing = readSkillText(mainFile);
					const existingFrontmatter = parseFrontmatter(existing).frontmatter;
					const description = params.description?.trim() || existingFrontmatter.description || `Reusable workflow for ${name}`;
					writeFileSync(mainFile, renderSkillMarkdown(name, description, content), "utf8");
					return {
						...buildToolText({
							success: true,
							action,
							name,
							path: mainFile,
						}),
						details: buildDetails({ action, name, path: mainFile }),
					};
				}
				case "write_file": {
					const content = params.content ?? "";
					const target = resolveWritableSupportingFile(name, params.filePath);
					mkdirSync(dirname(target.path), { recursive: true });
					writeFileSync(target.path, content.replace(/\r\n/g, "\n"), "utf8");
					return {
						...buildToolText({
							success: true,
							action,
							name,
							path: target.path,
							relativePath: target.relativePath,
						}),
						details: buildDetails({ action, name, path: target.path }),
					};
				}
				case "delete": {
					const dir = ensureLocalMutableSkill(name);
					const archiveRoot = join(localSkillsDir(), ".archive");
					mkdirSync(archiveRoot, { recursive: true });
					const archivedDir = join(archiveRoot, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
					renameSync(dir, archivedDir);
					return {
						...buildToolText({
							success: true,
							action,
							name,
							archivedDir,
							hint: "The skill was archived, not permanently deleted.",
						}),
						details: buildDetails({ action, name, path: archivedDir }),
					};
				}
			}
		},
	});
}

export function createSkillTools(cwd = process.cwd()) {
	return [
		createSkillsListTool(cwd),
		createSkillViewTool(cwd),
		createSkillManageTool(),
	];
}
