import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSkillTools } from "../tools/skills.ts";

function parseToolJson(result: Awaited<ReturnType<any["execute"]>>) {
	const text = result.content[0]?.text;
	assert.equal(typeof text, "string");
	return JSON.parse(text);
}

test("skill tools create, list, view, and write local Apreal skills", async () => {
	const root = mkdtempSync(join(tmpdir(), "apreal-skills-"));
	const previousAgentDir = process.env.APREAL_AGENT_DIR;
	try {
		process.env.APREAL_AGENT_DIR = join(root, "agent");
		const cwd = join(root, "workspace");
		const [skillsList, skillView, skillManage] = createSkillTools(cwd);
		assert.ok(skillsList);
		assert.ok(skillView);
		assert.ok(skillManage);

		const createResult = await skillManage.execute("tool-1", {
			action: "create",
			name: "debug-widget",
			description: "Debugs the widget workflow.",
			content: "# Debug widget\n\nRun the widget diagnostics.",
		}, undefined, undefined, {} as any);
		const created = parseToolJson(createResult);
		assert.equal(created.success, true);
		assert.equal(created.name, "debug-widget");
		assert.match(readFileSync(created.path, "utf8"), /description: "Debugs the widget workflow\."/);

		const listResult = await skillsList.execute("tool-2", {
			query: "widget",
		}, undefined, undefined, {} as any);
		const listed = parseToolJson(listResult);
		assert.equal(listed.count, 1);
		assert.equal(listed.skills[0].name, "debug-widget");
		assert.equal(listed.skills[0].source, "user");

		const viewResult = await skillView.execute("tool-3", {
			name: "debug-widget",
		}, undefined, undefined, {} as any);
		const viewed = parseToolJson(viewResult);
		assert.equal(viewed.success, true);
		assert.equal(viewed.content, "# Debug widget\n\nRun the widget diagnostics.");
		assert.equal(viewed.linkedFiles.references, undefined);

		const writeResult = await skillManage.execute("tool-4", {
			action: "write_file",
			name: "debug-widget",
			filePath: "references/checklist.md",
			content: "- Check logs\n",
		}, undefined, undefined, {} as any);
		const written = parseToolJson(writeResult);
		assert.equal(written.relativePath, "references/checklist.md");

		const fileResult = await skillView.execute("tool-5", {
			name: "debug-widget",
			filePath: "references/checklist.md",
		}, undefined, undefined, {} as any);
		const viewedFile = parseToolJson(fileResult);
		assert.equal(viewedFile.content, "- Check logs\n");
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.APREAL_AGENT_DIR;
		} else {
			process.env.APREAL_AGENT_DIR = previousAgentDir;
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill tools reject supporting file path traversal", async () => {
	const root = mkdtempSync(join(tmpdir(), "apreal-skills-"));
	const previousAgentDir = process.env.APREAL_AGENT_DIR;
	try {
		process.env.APREAL_AGENT_DIR = join(root, "agent");
		const [, , skillManage] = createSkillTools(join(root, "workspace"));
		assert.ok(skillManage);
		await skillManage.execute("tool-1", {
			action: "create",
			name: "safe-skill",
			description: "Safe skill.",
			content: "Do safe things.",
		}, undefined, undefined, {} as any);

		await assert.rejects(
			() => skillManage.execute("tool-2", {
				action: "write_file",
				name: "safe-skill",
				filePath: "references/../../escape.md",
				content: "nope",
			}, undefined, undefined, {} as any),
			/filePath must stay inside the skill directory/,
		);
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.APREAL_AGENT_DIR;
		} else {
			process.env.APREAL_AGENT_DIR = previousAgentDir;
		}
		rmSync(root, { recursive: true, force: true });
	}
});
