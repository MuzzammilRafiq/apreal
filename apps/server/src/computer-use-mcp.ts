import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { BuiltInMcpServerDefinition } from "./mcp-store.ts";
import { RUNTIME_ASSETS } from "./runtime-assets.ts";

const require = createRequire(import.meta.url);

const BUILT_IN_COMPUTER_USE_ID = "built-in-open-computer-use";

export function createComputerUseMcpDefinition(): BuiltInMcpServerDefinition {
	const launcherPath = RUNTIME_ASSETS.computerUseLauncher ?? join(
		dirname(require.resolve("open-computer-use/package.json")),
		"bin",
		"open-computer-use",
	);

	return {
		id: BUILT_IN_COMPUTER_USE_ID,
		name: "Computer Use",
		transport: "stdio",
		enabled: false,
		command: process.execPath,
		args: [launcherPath, "mcp"],
		env: {},
		url: null,
		headers: {},
	};
}
