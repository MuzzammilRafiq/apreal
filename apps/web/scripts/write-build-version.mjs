import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const outputDir = path.join(webRoot, "src", "generated");
const outputFile = path.join(outputDir, "build-version.ts");

function getGitValue(args) {
	try {
		return execFileSync(
			"git",
			args,
			{ cwd: repoRoot, encoding: "utf8" },
		).trim();
	} catch {
		return "";
	}
}

function buildGitHubCommitUrl(remoteUrl, commitHash) {
	if (!remoteUrl || !commitHash) {
		return null;
	}

	const normalizedRemote = remoteUrl.endsWith(".git")
		? remoteUrl.slice(0, -4)
		: remoteUrl;

	if (normalizedRemote.startsWith("https://github.com/")) {
		return `${normalizedRemote}/commit/${commitHash}`;
	}

	const sshMatch = normalizedRemote.match(/^git@github\.com:(.+)$/);
	if (sshMatch) {
		return `https://github.com/${sshMatch[1]}/commit/${commitHash}`;
	}

	return null;
}

const lastCommitDate = getGitValue(["log", "-1", "--date=short", "--format=%cd"]) || "unknown";
const commitHash = getGitValue(["rev-parse", "HEAD"]) || "unknown";
const shortCommitHash = commitHash === "unknown"
	? "unknown"
	: getGitValue(["rev-parse", "--short=7", "HEAD"]) || commitHash.slice(0, 7);
const originUrl = getGitValue(["remote", "get-url", "origin"]);
const commitUrl = buildGitHubCommitUrl(originUrl, commitHash);

const fileContents = `export const BUILD_VERSION: {
  label: string;
  updatedAt: string;
  commitHash: string;
  shortCommitHash: string;
  commitUrl: string | null;
} = ${JSON.stringify({
	label: `Updated ${lastCommitDate}`,
	updatedAt: lastCommitDate,
	commitHash,
	shortCommitHash,
	commitUrl,
})};\n`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputFile, fileContents, "utf8");
