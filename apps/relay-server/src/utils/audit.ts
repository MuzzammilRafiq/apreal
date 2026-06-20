import type { IncomingMessage } from "node:http";

import { log } from "./log.ts";

export const AUDIT_EVENTS = [
	"auth.sign_in",
	"auth.sign_out",
	"auth.owner_grant_issued",
	"auth.token_issued",
	"auth.token_refreshed",
	"pairing.agent_bound",
	"pairing.client_resolved",
	"authorization.failed",
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];
export type AuditOutcome = "success" | "failure";

export type AuditFields = {
	actorType?: "user" | "agent" | "client";
	actorId?: string;
	ownerUserId?: string;
	targetType?: "agent" | "client";
	targetId?: string;
	method?: string;
	path?: string;
	remoteAddress?: string;
	transport?: "http" | "sse" | "websocket";
	statusCode?: number;
	reason?:
		| "invalid_request"
		| "missing_owner_binding"
		| "request_rejected"
		| "session_required"
		| "unexpected_error";
};

export type AuditRecord = AuditFields & {
	auditEvent: AuditEvent;
	auditOutcome: AuditOutcome;
};

// Extracts only explicitly approved request metadata. Headers, cookies, query
// parameters, and request bodies are intentionally unavailable to audit logs.
export function getAuditRequestFields(request: IncomingMessage): AuditFields {
	return {
		method: request.method,
		path: new URL(request.url ?? "/", "http://relay.local").pathname,
		remoteAddress: request.socket.remoteAddress,
	};
}

// Builds the stable machine-readable record used by tests and log consumers.
export function createAuditRecord(
	event: AuditEvent,
	outcome: AuditOutcome,
	fields: AuditFields = {},
): AuditRecord {
	return {
		...fields,
		auditEvent: event,
		auditOutcome: outcome,
	};
}

// Emits one security audit event. The closed AuditFields type prevents callers
// from accidentally spreading credentials or arbitrary request data into it.
export function audit(event: AuditEvent, outcome: AuditOutcome, fields: AuditFields = {}) {
	log(outcome === "failure" ? "warn" : "info", "security audit", createAuditRecord(event, outcome, fields));
}
