import { Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PYTHON_SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/python");

export const webSearchTool = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Searches the public web and returns extracted page text. Use this when the answer depends on current external information.",
	parameters: Type.Object({
		query: Type.String({ description: "Search query to run." }),
	}),
	async execute(_toolCallId, params) {
		const child = Bun.spawn(["uv", "run", "main.py", params.query], {
			cwd: PYTHON_SCRIPTS_DIR,
			env: process.env,
			stdout: "pipe",
			stderr: "pipe",
		});

		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);

		if (exitCode !== 0) {
			const errorText = stderr.trim() || stdout.trim() || `uv exited with code ${exitCode}`;
			throw new Error(`web_search failed: ${errorText}`);
		}

		let results: unknown;
		try {
			results = JSON.parse(stdout);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`web_search returned invalid JSON: ${message}`);
		}

		if (!Array.isArray(results)) {
			throw new Error("web_search returned an unexpected response shape.");
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							query: params.query,
							results,
						},
						null,
						2,
					),
				},
			],
			details: {
				query: params.query,
				resultCount: results.length,
			},
		};
	},
});