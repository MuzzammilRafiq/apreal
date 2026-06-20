import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const relayRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const relayDistRoot = join(relayRoot, "dist");
const relayDistDir = join(relayRoot, "dist", "src");
const sharedDistFile = join(relayRoot, "..", "shared", "dist", "index.js");
const bundledSharedFile = join(relayDistDir, "shared.js");
const relayPackageFile = join(relayRoot, "package.json");
const deployPackageFile = join(relayDistRoot, "package.json");
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

const relayPackage = JSON.parse(readFileSync(relayPackageFile, "utf8"));
const deployPackage = {
	name: relayPackage.name,
	private: true,
	type: relayPackage.type,
	scripts: {
		start: "node src/index.js",
		test: "node --test src/tests/*.test.js",
	},
	dependencies: Object.fromEntries(
		Object.entries(relayPackage.dependencies ?? {}).filter(([name]) => name !== "@apreal/shared"),
	),
};
writeFileSync(deployPackageFile, `${JSON.stringify(deployPackage, null, "\t")}\n`);

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
