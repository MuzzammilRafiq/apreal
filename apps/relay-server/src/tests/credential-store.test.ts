import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RelayCredentialStore } from "../credential-store.ts";

test("tracks and revokes one relay credential without affecting another", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "relay-credentials-"));
	t.after(() => rmSync(directory, { force: true, recursive: true }));
	const path = join(directory, "credentials.json");
	const store = new RelayCredentialStore(path);
	const browser = store.create("client", "client-one", "owner-one");
	const agent = store.create("agent", "agent-one", "owner-one");

	assert.equal(store.countActive(), 2);
	assert.equal(store.assertActive(browser.credentialId, "client", "client-one").credentialId, browser.credentialId);
	assert.equal(store.revoke(browser.credentialId, "owner-two"), null, "another owner cannot revoke it");
	assert.equal(store.revoke(browser.credentialId, "owner-one")?.revokedAt !== null, true);
	assert.throws(() => store.assertActive(browser.credentialId, "client", "client-one"), /revoked/i);
	assert.equal(store.assertActive(agent.credentialId, "agent", "agent-one").credentialId, agent.credentialId);
	assert.equal(store.countActive(), 1);
	assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("persists credential revocation across store instances", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "relay-credentials-"));
	t.after(() => rmSync(directory, { force: true, recursive: true }));
	const path = join(directory, "credentials.json");
	const firstStore = new RelayCredentialStore(path);
	const credential = firstStore.create("agent", "agent-persisted", "owner-persisted");
	firstStore.revoke(credential.credentialId, "owner-persisted");

	const restoredStore = new RelayCredentialStore(path);
	assert.equal(restoredStore.listForOwner("owner-persisted")[0]?.revokedAt !== null, true);
	assert.throws(
		() => restoredStore.assertActive(credential.credentialId, "agent", "agent-persisted"),
		/revoked/i,
	);
});
