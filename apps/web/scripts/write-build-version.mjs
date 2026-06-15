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

function getLastCommitDate() {
	try {
		const rawDate = execFileSync(
			"git",
			["log", "-1", "--date=short", "--format=%cd"],
			{ cwd: repoRoot, encoding: "utf8" },
		).trim();

		if (!rawDate) {
			throw new Error("Empty git commit date.");
		}

		return rawDate;
	} catch {
		return "unknown";
	}
}

const lastCommitDate = getLastCommitDate();
const fileContents = `export const BUILD_VERSION = "Updated ${lastCommitDate}" as const;\n`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputFile, fileContents, "utf8");
