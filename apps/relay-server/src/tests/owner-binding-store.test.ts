import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { RelayOwnerBindingStore } from "../owner-binding-store.ts";

function createStore(t: TestContext) {
	const directory = mkdtempSync(join(tmpdir(), "relay-owner-store-"));
	t.after(() => rmSync(directory, { force: true, recursive: true }));
	const filePath = join(directory, "bindings.json");
	return {
		filePath,
		store: new RelayOwnerBindingStore(filePath),
	};
}

test("maintains one active agent per owner and one owner per agent", (t) => {
	const { store } = createStore(t);

	store.bindAgentToOwner("agent-one", "agent-key-one", "owner-one");
	store.bindAgentToOwner("agent-two", "agent-key-two", "owner-two");
	store.bindAgentToOwner("agent-one", "agent-key-rotated", "owner-three");

	assert.equal(store.countBindings(), 2);
	assert.equal(store.findLatestAgentByOwnerUserId("owner-one"), null);
	assert.equal(store.findOwnerUserIdForAgent("agent-one", "agent-key-one"), null);
	assert.equal(store.findOwnerUserIdForAgent("agent-one", "agent-key-rotated"), "owner-three");

	store.bindAgentToOwner("agent-three", "agent-key-three", "owner-two");

	assert.equal(store.countBindings(), 2);
	assert.equal(store.findOwnerUserIdForAgent("agent-two", "agent-key-two"), null);
	assert.equal(store.findLatestAgentByOwnerUserId("owner-two")?.agentId, "agent-three");
});

test("ignores malformed persisted bindings without losing valid records", (t) => {
	const { filePath, store } = createStore(t);
	writeFileSync(filePath, JSON.stringify({
		agents: [
			{
				agentId: "agent-valid",
				agentKey: "agent-key-valid",
				ownerUserId: "owner-valid",
				updatedAt: 100,
			},
			{
				agentId: "bad id",
				agentKey: "agent-key-invalid",
				ownerUserId: "owner-invalid",
				updatedAt: 200,
			},
			null,
		],
	}));

	assert.equal(store.countBindings(), 1);
	assert.equal(store.findOwnerUserIdForAgent("agent-valid", "agent-key-valid"), "owner-valid");

	store.bindAgentToOwner("agent-next", "agent-key-next", "owner-next");
	const persisted = JSON.parse(readFileSync(filePath, "utf8")) as { agents: unknown[] };
	assert.equal(persisted.agents.length, 2);
});

test("recovers from an unreadable store when a new binding is written", (t) => {
	const { filePath, store } = createStore(t);
	writeFileSync(filePath, "{not-json");

	assert.equal(store.countBindings(), 0);
	store.bindAgentToOwner("agent-recovered", "agent-key-recovered", "owner-recovered");

	assert.equal(store.findOwnerUserIdForAgent("agent-recovered", "agent-key-recovered"), "owner-recovered");
	assert.doesNotThrow(() => JSON.parse(readFileSync(filePath, "utf8")));
});
