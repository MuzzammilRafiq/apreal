import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(serverDir, "..", "..");
const version = process.env.APREAL_RELEASE_VERSION?.trim() || "0.1.0";
const outputRoot = resolve(repositoryRoot, "dist", "release", `apreal-${version}-darwin-arm64`);
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

await build({
	entryPoints: [join(serverDir, "src", "cli.ts")],
	outfile: join(outputRoot, "server", "apreal-cli.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	banner: {
		js: "import { createRequire as __aprealCreateRequire } from 'node:module'; const require = __aprealCreateRequire(import.meta.url);",
	},
});

await mkdir(join(outputRoot, "launcher"), { recursive: true });
await cp(join(serverDir, "scripts", "apreal"), join(outputRoot, "launcher", "apreal"));
await chmod(join(outputRoot, "launcher", "apreal"), 0o755);

await cp(join(repositoryRoot, "apps", "web", "dist"), join(outputRoot, "web", "dist"), {
	recursive: true,
});
await cp(join(repositoryRoot, "scripts", "python"), join(outputRoot, "python"), {
	recursive: true,
});
await cp(join(repositoryRoot, "LICENSE"), join(outputRoot, "LICENSE"));
const computerUsePackageDir = dirname(require.resolve("open-computer-use/package.json"));
await cp(computerUsePackageDir, join(outputRoot, "server", "vendor", "open-computer-use"), {
	recursive: true,
});
await writeFile(join(outputRoot, "VERSION"), `${version}\n`, { mode: 0o644 });

console.log(outputRoot);
