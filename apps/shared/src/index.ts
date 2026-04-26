export const RELAY_CONNECTION_PATH = "/api/relay/connection";
export const RELAY_PRINCIPAL_TYPES = ["agent", "client"] as const;

export type RelayPrincipalType = (typeof RELAY_PRINCIPAL_TYPES)[number];

export type RelayConnectionRequest = {
	targetId: string;
	targetType?: RelayPrincipalType;
};

export type RelayConnectionResponse = {
	principal: {
		id: string;
		type: RelayPrincipalType;
		expiresAt: number;
		scopedToTarget: boolean;
	};
	target: {
		id: string;
		type: RelayPrincipalType;
	};
};

const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const PAIRING_CODE_PATTERN = /^[A-Z0-9]{6,16}$/;

export function isRelayPrincipalType(value: unknown): value is RelayPrincipalType {
	return typeof value === "string" && RELAY_PRINCIPAL_TYPES.includes(value as RelayPrincipalType);
}

export function normalizeRelayPrincipalId(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (!PRINCIPAL_ID_PATTERN.test(trimmed)) {
		return null;
	}

	return trimmed;
}

export function normalizeRelayPairingCode(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "");
	if (!PAIRING_CODE_PATTERN.test(normalized)) {
		return null;
	}

	return normalized;
}

export function assertRelayPrincipalId(value: unknown, field = "id"): string {
	const normalized = normalizeRelayPrincipalId(value);
	if (!normalized) {
		throw new Error(`invalid relay principal id: ${field}`);
	}

	return normalized;
}

export function assertRelayPairingCode(value: unknown, field = "pairingCode"): string {
	const normalized = normalizeRelayPairingCode(value);
	if (!normalized) {
		throw new Error(`invalid relay pairing code: ${field}`);
	}

	return normalized;
}
