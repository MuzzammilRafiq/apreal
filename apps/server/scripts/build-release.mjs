import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(serverDir, "..", "..");
const version = process.env.APREAL_RELEASE_VERSION?.trim() || "0.1.0";
const releaseTestBase = resolve(homedir(), `.apreal-${version}`);
const outputRoot = resolve(releaseTestBase, "bin");
const require = createRequire(import.meta.url);
const run = promisify(execFile);

const nodeVersion = process.env.APREAL_NODE_VERSION?.trim() || "24.18.0";
const uvVersion = process.env.APREAL_UV_VERSION?.trim() || "0.11.28";
const pythonVersion = process.env.APREAL_PYTHON_VERSION?.trim() || "3.14";

async function download(url) {
	console.log(`Downloading ${url}`);
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

function verifySha256(contents, expected, label) {
	const actual = createHash("sha256").update(contents).digest("hex");
	if (actual !== expected.toLowerCase()) {
		throw new Error(`SHA-256 mismatch for ${label}: expected ${expected}, received ${actual}`);
	}
}

async function installPrivateRuntimes() {
	if (process.platform !== "darwin" || process.arch !== "arm64") {
		throw new Error("Release runtime assembly currently supports only macOS Apple Silicon (darwin-arm64)");
	}

	const runtimeDir = join(outputRoot, "runtime");
	const workDir = await mkdtemp(join(tmpdir(), "apreal-runtimes-"));
	await mkdir(runtimeDir, { recursive: true });

	try {
		const nodeArchiveName = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
		const nodeBaseUrl = `https://nodejs.org/dist/v${nodeVersion}`;
		const [nodeArchive, nodeChecksums] = await Promise.all([
			download(`${nodeBaseUrl}/${nodeArchiveName}`),
			download(`${nodeBaseUrl}/SHASUMS256.txt`),
		]);
		const nodeChecksumLine = nodeChecksums
			.toString("utf8")
			.split(/\r?\n/)
			.find((line) => line.trim().endsWith(`  ${nodeArchiveName}`));
		if (!nodeChecksumLine) throw new Error(`No published checksum found for ${nodeArchiveName}`);
		verifySha256(nodeArchive, nodeChecksumLine.trim().split(/\s+/)[0], nodeArchiveName);
		const nodeArchivePath = join(workDir, nodeArchiveName);
		await writeFile(nodeArchivePath, nodeArchive);
		await mkdir(join(runtimeDir, "node"), { recursive: true });
		await run("tar", ["-xzf", nodeArchivePath, "-C", join(runtimeDir, "node"), "--strip-components=1"]);

		const uvArchiveName = "uv-aarch64-apple-darwin.tar.gz";
		const uvBaseUrl = `https://github.com/astral-sh/uv/releases/download/${uvVersion}`;
		const [uvArchive, uvChecksumFile] = await Promise.all([
			download(`${uvBaseUrl}/${uvArchiveName}`),
			download(`${uvBaseUrl}/${uvArchiveName}.sha256`),
		]);
		const uvChecksum = uvChecksumFile.toString("utf8").trim().split(/\s+/)[0];
		verifySha256(uvArchive, uvChecksum, uvArchiveName);
		const uvArchivePath = join(workDir, uvArchiveName);
		const uvExtractDir = join(workDir, "uv");
		await writeFile(uvArchivePath, uvArchive);
		await mkdir(uvExtractDir, { recursive: true });
		await run("tar", ["-xzf", uvArchivePath, "-C", uvExtractDir]);
		const [uvTopLevel] = await readdir(uvExtractDir);
		await mkdir(join(runtimeDir, "uv"), { recursive: true });
		await cp(join(uvExtractDir, uvTopLevel, "uv"), join(runtimeDir, "uv", "uv"));

		const uvExecutable = join(runtimeDir, "uv", "uv");
		const uvEnvironment = {
			...process.env,
			UV_PYTHON_INSTALL_DIR: join(runtimeDir, "python"),
			UV_CACHE_DIR: join(workDir, "uv-cache"),
			UV_PROJECT_ENVIRONMENT: join(outputRoot, "python", ".venv"),
		};
		console.log(`Installing private Python ${pythonVersion}`);
		await run(uvExecutable, ["python", "install", pythonVersion], { env: uvEnvironment });
		await run(uvExecutable, ["sync", "--project", join(outputRoot, "python"), "--frozen", "--python", pythonVersion], {
			env: uvEnvironment,
		});
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

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
await installPrivateRuntimes();
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
