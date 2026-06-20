import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { BuiltInMcpServerDefinition } from "./mcp-store.ts";

const require = createRequire(import.meta.url);

export const BUILT_IN_COMPUTER_USE_ID = "built-in-open-computer-use";

export function createComputerUseMcpDefinition(): BuiltInMcpServerDefinition {
	const packageJsonPath = require.resolve("open-computer-use/package.json");
	const launcherPath = join(dirname(packageJsonPath), "bin", "open-computer-use");

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
