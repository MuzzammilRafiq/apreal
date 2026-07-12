import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { resolveRuntimeAssets } from "../runtime-assets.ts";

test("resolves development assets from the repository", () => {
	const assets = resolveRuntimeAssets(pathToFileURL("/repo/apps/server/src/runtime-assets.ts").href);

	assert.equal(assets.releaseRoot, "/repo");
	assert.equal(assets.webDistDir, "/repo/apps/web/dist");
	assert.equal(assets.pythonDir, "/repo/scripts/python");
	assert.equal(assets.uvExecutable, "uv");
	assert.equal(assets.computerUseLauncher, null);
});

test("resolves installed assets from the release root", () => {
	const assets = resolveRuntimeAssets(pathToFileURL("/home/.apreal/versions/0.1.0/server/apreal-server.mjs").href);

	assert.equal(assets.releaseRoot, "/home/.apreal/versions/0.1.0");
	assert.equal(assets.webDistDir, "/home/.apreal/versions/0.1.0/web/dist");
	assert.equal(assets.pythonDir, "/home/.apreal/versions/0.1.0/python");
	assert.equal(assets.uvExecutable, "/home/.apreal/versions/0.1.0/runtime/uv/uv");
	assert.equal(assets.computerUseLauncher, "/home/.apreal/versions/0.1.0/server/vendor/open-computer-use/bin/open-computer-use");
});
