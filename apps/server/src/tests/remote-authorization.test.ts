import assert from "node:assert/strict";
import test from "node:test";

import type { ClientAppMessage } from "../protocol.ts";
import { isRelayClientMessageAllowed } from "../web/handlers.ts";

test("allows relay chat and model selection while rejecting laptop administration", () => {
	const allowedMessages: ClientAppMessage[] = [
		{ type: "prompt", prompt: "hello" },
		{ type: "abort", sessionId: "session-1" },
		{ type: "delete_session", sessionId: "session-1" },
		{ type: "delete_all_sessions" },
		{ type: "load_session", sessionId: "session-1" },
		{ type: "load_sessions_page" },
		{ type: "load_providers" },
		{ type: "set_default_model", provider: "example", modelId: "model" },
		{ type: "ping" },
	];
	const localOnlyMessages: ClientAppMessage[] = [
		{ type: "load_status" },
		{ type: "save_provider_api_key", provider: "example", apiKey: "secret" },
		{ type: "start_provider_login", provider: "example" },
		{ type: "load_jobs" },
		{ type: "load_job_runs", jobId: "job-1" },
		{ type: "update_job", jobId: "job-1", changes: { enabled: false } },
		{ type: "delete_job", jobId: "job-1" },
		{ type: "save_append_system_prompt", appendSystemPrompt: "local only" },
		{ type: "load_mcp_servers" },
		{ type: "refresh_mcp_servers" },
		{ type: "create_mcp_server", request: { name: "example", transport: "stdio", command: "example" } },
		{ type: "delete_mcp_server", serverId: "server-1" },
	];

	for (const message of allowedMessages) {
		assert.equal(isRelayClientMessageAllowed(message), true, message.type);
	}
	for (const message of localOnlyMessages) {
		assert.equal(isRelayClientMessageAllowed(message), false, message.type);
	}
});
