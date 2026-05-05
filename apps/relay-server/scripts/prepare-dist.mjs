import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const relayRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const relayDistDir = join(relayRoot, "dist", "src");
const sharedDistFile = join(relayRoot, "..", "shared", "dist", "index.js");
const bundledSharedFile = join(relayDistDir, "shared.js");
const sharedImportPattern = /from\s+(["'])@apreal\/shared\1/g;

function* walkJavaScriptFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* walkJavaScriptFiles(fullPath);
			continue;
		}

		if (entry.isFile() && fullPath.endsWith(".js")) {
			yield fullPath;
		}
	}
}

if (!existsSync(sharedDistFile)) {
	throw new Error(`missing shared build output at ${sharedDistFile}`);
}

mkdirSync(relayDistDir, { recursive: true });
copyFileSync(sharedDistFile, bundledSharedFile);

for (const filePath of walkJavaScriptFiles(relayDistDir)) {
	if (filePath === bundledSharedFile) {
		continue;
	}

	const source = readFileSync(filePath, "utf8");
	if (!source.includes("@apreal/shared")) {
		continue;
	}

	const relativeSharedPath = relative(dirname(filePath), bundledSharedFile).replaceAll("\\", "/");
	const normalizedSharedPath = relativeSharedPath.startsWith(".") ? relativeSharedPath : `./${relativeSharedPath}`;
	const rewritten = source.replace(sharedImportPattern, `from "${normalizedSharedPath}"`);
	writeFileSync(filePath, rewritten);
}