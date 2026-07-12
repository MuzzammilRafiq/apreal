import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(serverDir, "..", "..");
const version = process.env.APREAL_RELEASE_VERSION?.trim() || "0.1.0";
const releaseTestBase = resolve(homedir(), `.apreal-${version}`);
const outputRoot = resolve(releaseTestBase, "bin");
const require = createRequire(import.meta.url);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(outputRoot, "server"), { recursive: true });

await build({
	entryPoints: [join(serverDir, "src", "index.ts")],
	outfile: join(outputRoot, "server", "apreal-server.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	sourcemap: true,
	banner: {
		js: "import { createRequire as __aprealCreateRequire } from 'node:module'; const require = __aprealCreateRequire(import.meta.url);",
	},
});

await cp(join(repositoryRoot, "apps", "web", "dist"), join(outputRoot, "web", "dist"), {
	recursive: true,
});
await cp(join(repositoryRoot, "scripts", "python"), join(outputRoot, "python"), {
	recursive: true,
});
const computerUsePackageDir = dirname(require.resolve("open-computer-use/package.json"));
await cp(computerUsePackageDir, join(outputRoot, "server", "vendor", "open-computer-use"), {
	recursive: true,
});
await writeFile(join(outputRoot, "VERSION"), `${version}\n`, { mode: 0o644 });

const sourceAgentDir = resolve(homedir(), ".apreal", "agent");
const testAgentDir = resolve(releaseTestBase, "agent");
await rm(testAgentDir, { recursive: true, force: true });
await cp(sourceAgentDir, testAgentDir, { recursive: true });

console.log(outputRoot);
