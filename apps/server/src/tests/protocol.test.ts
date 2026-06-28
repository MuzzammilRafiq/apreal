import assert from "node:assert/strict";
import test from "node:test";
import { parseClientAppMessage } from "@apreal/shared";

test("parses valid client messages with optional wire fields", () => {
	assert.deepEqual(parseClientAppMessage({ type: "prompt", prompt: "hello" }), {
		type: "prompt",
		prompt: "hello",
	});
	assert.deepEqual(parseClientAppMessage({ type: "load_sessions_page" }), {
		type: "load_sessions_page",
	});
	assert.deepEqual(parseClientAppMessage({ type: "set_default_model", provider: " openai ", modelId: " gpt-5 " }), {
		type: "set_default_model",
		provider: "openai",
		modelId: "gpt-5",
	});
});

test("rejects malformed client messages at the shared schema boundary", () => {
	assert.equal(parseClientAppMessage({ type: "prompt", prompt: 123 }), null);
	assert.equal(parseClientAppMessage({ type: "update_job", jobId: "job-1", changes: {} }), null);
	assert.equal(parseClientAppMessage({ type: "create_mcp_server", request: { name: "bad", transport: "ftp" } }), null);
	assert.equal(parseClientAppMessage({ type: "save_provider_api_key", provider: "", apiKey: "key" }), null);
});
