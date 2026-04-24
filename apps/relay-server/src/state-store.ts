import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	RELAY_CONNECTION_STATUSES,
	RELAY_HANDSHAKE_STATES,
	type RelayConnectionStatus,
	type RelayOutboundEnvelope,
	type RelayPairingRecord,
	type RelayPrincipalType,
	type RelayQueuedEnvelopeMetadata,
	type RelayRegistrationRecord,
} from "@apreal/shared";

type StoredQueueRow = {
	id: number;
	message_type: RelayQueuedEnvelopeMetadata["messageType"];
	from_id: string;
	from_type: RelayQueuedEnvelopeMetadata["fromType"];
	target_id: string;
	target_type: RelayQueuedEnvelopeMetadata["targetType"];
	action: RelayQueuedEnvelopeMetadata["action"];
	payload_json: string;
	created_at: number;
};

type RelayStorePrincipalInput = {
	principalId: string;
	principalType: RelayPrincipalType;
	connectionStatus: RelayConnectionStatus;
	handshakeState: RelayRegistrationRecord["handshakeState"];
	at: number;
};

type RelayStorePairingInput = {
	clientId: string;
	agentId: string;
	at: number;
};

type RelayStoreQueuedEnvelope = RelayQueuedEnvelopeMetadata & {
	envelope: RelayOutboundEnvelope<Record<string, unknown>>;
};

function getDefaultDatabasePath(): string {
	return join(process.cwd(), ".data", "relay-state.sqlite");
}

function assertConnectionStatus(value: string): RelayConnectionStatus {
	if (!RELAY_CONNECTION_STATUSES.includes(value as RelayConnectionStatus)) {
		throw new Error(`invalid relay connection status: ${value}`);
	}

	return value as RelayConnectionStatus;
}

function assertHandshakeState(value: string): RelayRegistrationRecord["handshakeState"] {
	if (!RELAY_HANDSHAKE_STATES.includes(value as RelayRegistrationRecord["handshakeState"])) {
		throw new Error(`invalid relay handshake state: ${value}`);
	}

	return value as RelayRegistrationRecord["handshakeState"];
}

export class RelayStateStore {
	private readonly database: DatabaseSync;

	constructor(databasePath = getDefaultDatabasePath()) {
		mkdirSync(dirname(databasePath), { recursive: true });
		this.database = new DatabaseSync(databasePath);
		this.database.exec("PRAGMA journal_mode = WAL");
		this.database.exec("PRAGMA foreign_keys = ON");
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS principals (
				principal_id TEXT PRIMARY KEY,
				principal_type TEXT NOT NULL,
				connection_status TEXT NOT NULL,
				handshake_state TEXT NOT NULL,
				last_authenticated_at INTEGER NOT NULL,
				last_connected_at INTEGER,
				last_disconnected_at INTEGER
			);

			CREATE TABLE IF NOT EXISTS pairings (
				client_id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS queued_envelopes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				message_type TEXT NOT NULL,
				from_id TEXT NOT NULL,
				from_type TEXT NOT NULL,
				target_id TEXT NOT NULL,
				target_type TEXT NOT NULL,
				action TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_principals_type ON principals (principal_type);
			CREATE INDEX IF NOT EXISTS idx_queued_target ON queued_envelopes (target_type, target_id, created_at, id);
		`);
	}

	upsertPrincipal(input: RelayStorePrincipalInput): RelayRegistrationRecord {
		this.database
			.prepare(
				`INSERT INTO principals (
					principal_id,
					principal_type,
					connection_status,
					handshake_state,
					last_authenticated_at,
					last_connected_at,
					last_disconnected_at
				) VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(principal_id) DO UPDATE SET
					principal_type = excluded.principal_type,
					connection_status = excluded.connection_status,
					handshake_state = excluded.handshake_state,
					last_authenticated_at = excluded.last_authenticated_at,
					last_connected_at = CASE
						WHEN excluded.connection_status = 'online' THEN excluded.last_connected_at
						ELSE principals.last_connected_at
					END,
					last_disconnected_at = CASE
						WHEN excluded.connection_status = 'offline' THEN excluded.last_disconnected_at
						ELSE principals.last_disconnected_at
					END`,
			)
			.run(
				input.principalId,
				input.principalType,
				input.connectionStatus,
				input.handshakeState,
				input.at,
				input.connectionStatus === "online" ? input.at : null,
				input.connectionStatus === "offline" ? input.at : null,
			);

		const row = this.database
			.prepare(
				`SELECT
					principal_id,
					principal_type,
					connection_status,
					handshake_state,
					last_authenticated_at,
					last_connected_at,
					last_disconnected_at
				FROM principals
				WHERE principal_id = ?`,
			)
			.get(input.principalId) as
			| {
					principal_id: string;
					principal_type: RelayPrincipalType;
					connection_status: string;
					handshake_state: string;
					last_authenticated_at: number;
					last_connected_at: number | null;
					last_disconnected_at: number | null;
				}
			| undefined;

		if (!row) {
			throw new Error(`missing principal after upsert: ${input.principalId}`);
		}

		return {
			principalId: row.principal_id,
			principalType: row.principal_type,
			connectionStatus: assertConnectionStatus(row.connection_status),
			handshakeState: assertHandshakeState(row.handshake_state),
			lastAuthenticatedAt: row.last_authenticated_at,
			lastConnectedAt: row.last_connected_at,
			lastDisconnectedAt: row.last_disconnected_at,
		};
	}

	markPrincipalDisconnected(principalId: string, at: number) {
		this.database
			.prepare(
				`UPDATE principals
				SET connection_status = 'offline',
					handshake_state = 'ready',
					last_disconnected_at = ?
				WHERE principal_id = ?`,
			)
			.run(at, principalId);
	}

	replacePairing(input: RelayStorePairingInput): RelayPairingRecord {
		const selectPairing = this.database.prepare(
			`SELECT client_id, agent_id, created_at, updated_at FROM pairings WHERE client_id = ?`,
		);
		const deleteByClient = this.database.prepare(`DELETE FROM pairings WHERE client_id = ?`);
		const deleteByAgent = this.database.prepare(`DELETE FROM pairings WHERE agent_id = ?`);
		const insertPairing = this.database.prepare(
			`INSERT INTO pairings (client_id, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		);

		this.database.exec("BEGIN IMMEDIATE");
		try {
			const existing = selectPairing.get(input.clientId) as
				| { created_at: number }
				| undefined;
			deleteByClient.run(input.clientId);
			deleteByAgent.run(input.agentId);
			insertPairing.run(input.clientId, input.agentId, existing?.created_at ?? input.at, input.at);
			this.database.exec("COMMIT");
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}

		return this.getPairingByClientId(input.clientId)!;
	}

	getPairingByClientId(clientId: string): RelayPairingRecord | null {
		const row = this.database
			.prepare(`SELECT client_id, agent_id, created_at, updated_at FROM pairings WHERE client_id = ?`)
			.get(clientId) as
			| { client_id: string; agent_id: string; created_at: number; updated_at: number }
			| undefined;

		if (!row) {
			return null;
		}

		return {
			clientId: row.client_id,
			agentId: row.agent_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	getPairingByAgentId(agentId: string): RelayPairingRecord | null {
		const row = this.database
			.prepare(`SELECT client_id, agent_id, created_at, updated_at FROM pairings WHERE agent_id = ?`)
			.get(agentId) as
			| { client_id: string; agent_id: string; created_at: number; updated_at: number }
			| undefined;

		if (!row) {
			return null;
		}

		return {
			clientId: row.client_id,
			agentId: row.agent_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	enqueueEnvelope(envelope: RelayOutboundEnvelope<Record<string, unknown>>, createdAt: number): RelayQueuedEnvelopeMetadata {
		const result = this.database
			.prepare(
				`INSERT INTO queued_envelopes (
					message_type,
					from_id,
					from_type,
					target_id,
					target_type,
					action,
					payload_json,
					created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				RETURNING id`,
			)
			.get(
				envelope.type,
				envelope.fromId,
				envelope.fromType,
				envelope.targetId,
				envelope.to,
				envelope.action,
				JSON.stringify(envelope.payload),
				createdAt,
			) as { id: number };

		return {
			id: result.id,
			messageType: envelope.type,
			fromId: envelope.fromId,
			fromType: envelope.fromType,
			targetId: envelope.targetId,
			targetType: envelope.to,
			action: envelope.action,
			createdAt,
		};
	}

	listQueuedEnvelopesForTarget(targetType: RelayPrincipalType, targetId: string): RelayStoreQueuedEnvelope[] {
		const rows = this.database
			.prepare(
				`SELECT id, message_type, from_id, from_type, target_id, target_type, action, payload_json, created_at
				FROM queued_envelopes
				WHERE target_type = ? AND target_id = ?
				ORDER BY created_at ASC, id ASC`,
			)
			.all(targetType, targetId) as StoredQueueRow[];

		return rows.map((row) => ({
			id: row.id,
			messageType: row.message_type,
			fromId: row.from_id,
			fromType: row.from_type,
			targetId: row.target_id,
			targetType: row.target_type,
			action: row.action,
			createdAt: row.created_at,
			envelope: {
				type: row.message_type,
				to: row.target_type,
				targetId: row.target_id,
				action: row.action,
				fromId: row.from_id,
				fromType: row.from_type,
				payload: JSON.parse(row.payload_json) as Record<string, unknown>,
			},
		}));
	}

	deleteQueuedEnvelope(id: number) {
		this.database.prepare(`DELETE FROM queued_envelopes WHERE id = ?`).run(id);
	}
}