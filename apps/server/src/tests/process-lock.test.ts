import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireProcessLock, readLockedPid, SERVER_LOCK_FILENAME } from "../process-lock.ts";

test("process lock prevents a second server and releases cleanly", async () => {
	const directory = await mkdtemp(join(tmpdir(), "apreal-lock-"));
	try {
		const lock = await acquireProcessLock(directory);
		assert.equal(await readLockedPid(directory), process.pid);
		await assert.rejects(acquireProcessLock(directory), /already running.*PID/);
		await lock.release();
		assert.equal(await readLockedPid(directory), null);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("process lock replaces a stale PID file", async () => {
	const directory = await mkdtemp(join(tmpdir(), "apreal-lock-"));
	try {
		await writeFile(join(directory, SERVER_LOCK_FILENAME), "99999999\n");
		const lock = await acquireProcessLock(directory);
		assert.equal(await readLockedPid(directory), process.pid);
		await lock.release();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
