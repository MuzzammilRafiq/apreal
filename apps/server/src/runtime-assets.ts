import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeAssets = Readonly<{
	releaseRoot: string;
	webDistDir: string;
	pythonDir: string;
	uvExecutable: string;
	playwrightBrowsersDir: string | null;
	computerUseLauncher: string | null;
}>;

/**
 * Resolve immutable application assets without depending on the process cwd.
 *
 * In a release, this module is bundled into server/apreal-server.mjs and the
 * assets live beside that server directory. During development the module is
 * evaluated from apps/server/src and assets remain in their repository paths.
 */
export function resolveRuntimeAssets(moduleUrl = import.meta.url): RuntimeAssets {
	const moduleDir = dirname(fileURLToPath(moduleUrl));
	const isBundledRelease = moduleDir.endsWith(`${join("server")}`);
	const releaseRoot = isBundledRelease
		? resolve(moduleDir, "..")
		: resolve(moduleDir, "..", "..", "..");

	return Object.freeze({
		releaseRoot,
		webDistDir: isBundledRelease
			? join(releaseRoot, "web", "dist")
			: join(releaseRoot, "apps", "web", "dist"),
		pythonDir: isBundledRelease
			? join(releaseRoot, "python")
			: join(releaseRoot, "scripts", "python"),
		uvExecutable: isBundledRelease
			? join(releaseRoot, "runtime", "uv", "uv")
			: "uv",
		playwrightBrowsersDir: isBundledRelease
			? join(releaseRoot, "runtime", "playwright")
			: null,
		computerUseLauncher: isBundledRelease
			? join(moduleDir, "vendor", "open-computer-use", "bin", "open-computer-use")
			: null,
	});
}

export const RUNTIME_ASSETS = resolveRuntimeAssets();
