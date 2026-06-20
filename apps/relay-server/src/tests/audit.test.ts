import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";

import { createAuditRecord, getAuditRequestFields } from "../utils/audit.ts";

test("audit records contain stable structured event fields", () => {
	assert.deepEqual(
		createAuditRecord("auth.token_issued", "success", {
			actorType: "client",
			actorId: "client-one",
			targetType: "agent",
			targetId: "agent-one",
		}),
		{
			auditEvent: "auth.token_issued",
			auditOutcome: "success",
			actorType: "client",
			actorId: "client-one",
			targetType: "agent",
			targetId: "agent-one",
		},
	);
});

test("audit request metadata excludes credentials, headers, query parameters, and bodies", () => {
	const request = {
		method: "POST",
		url: "/api/relay/client/auth?token=query-secret",
		headers: {
			authorization: "Bearer header-secret",
			cookie: "session=cookie-secret",
		},
		socket: {
			remoteAddress: "127.0.0.1",
		},
	} as IncomingMessage;

	const serialized = JSON.stringify(getAuditRequestFields(request));
	assert.deepEqual(JSON.parse(serialized), {
		method: "POST",
		path: "/api/relay/client/auth",
		remoteAddress: "127.0.0.1",
	});
	assert.doesNotMatch(serialized, /query-secret|header-secret|cookie-secret|authorization|cookie|token/i);
});
