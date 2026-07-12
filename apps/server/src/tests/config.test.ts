import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadAprealRuntime, resetAprealRuntimeForTests } from "../config.ts";

test("configuration uses --home and applies defaults", () => {
	const home = mkdtempSync(join(tmpdir(), "apreal-config-"));
	try {
		resetAprealRuntimeForTests();
		const runtime = loadAprealRuntime(["--home", home]);
		assert.equal(runtime.home, home);
		assert.equal(runtime.config.server.port, 3000);
		assert.equal(runtime.paths.agent, join(home, "agent"));
		assert.ok(Object.isFrozen(runtime.config));
	} finally {
		resetAprealRuntimeForTests();
		rmSync(home, { recursive: true, force: true });
	}
});

test("configuration reads TOML and resolves relative state paths", () => {
	const home = mkdtempSync(join(tmpdir(), "apreal-config-"));
	try {
		writeFileSync(join(home, "config.toml"), `
[server]
port = 3100
log_level = "debug"
allow_private_network_admin = true

[paths]
agent_dir = "state/agent"
logs_dir = "state/logs"

[development]
cors_allow_origins = ["http://localhost:5173"]
`);
		resetAprealRuntimeForTests();
		const runtime = loadAprealRuntime([`--home=${home}`]);
		assert.equal(runtime.config.server.port, 3100);
		assert.equal(runtime.config.server.allow_private_network_admin, true);
		assert.equal(runtime.paths.agent, join(home, "state/agent"));
	} finally {
		resetAprealRuntimeForTests();
		rmSync(home, { recursive: true, force: true });
	}
});

test("configuration reports the invalid TOML key", () => {
	const home = mkdtempSync(join(tmpdir(), "apreal-config-"));
	try {
		mkdirSync(home, { recursive: true });
		writeFileSync(join(home, "config.toml"), "[server]\nport = \"not-a-port\"\n");
		resetAprealRuntimeForTests();
		assert.throws(() => loadAprealRuntime(["--home", home]), /server\.port/);
	} finally {
		resetAprealRuntimeForTests();
		rmSync(home, { recursive: true, force: true });
	}
});

test("configuration rejects absolute mutable paths", () => {
	const home = mkdtempSync(join(tmpdir(), "apreal-config-"));
	try {
		writeFileSync(join(home, "config.toml"), "[paths]\nagent_dir = \"/tmp/agent\"\n");
		resetAprealRuntimeForTests();
		assert.throws(() => loadAprealRuntime(["--home", home]), /paths\.agent_dir/);
	} finally {
		resetAprealRuntimeForTests();
		rmSync(home, { recursive: true, force: true });
	}
});

test("configuration rejects mutable path traversal", () => {
	const home = mkdtempSync(join(tmpdir(), "apreal-config-"));
	try {
		writeFileSync(join(home, "config.toml"), "[paths]\nlogs_dir = \"../logs\"\n");
		resetAprealRuntimeForTests();
		assert.throws(() => loadAprealRuntime(["--home", home]), /paths\.logs_dir/);
	} finally {
		resetAprealRuntimeForTests();
		rmSync(home, { recursive: true, force: true });
	}
});
