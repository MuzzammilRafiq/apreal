import { generateToken } from "../../relay-server/src/auth.ts";

export type ServerTransportMode = "local" | "relay";

export type RelayAgentTokenProvider = () => string | null;

export type ServerTransportConfig = {
	mode: ServerTransportMode;
	relayUrl: string | null;
	relayAgentId: string;
	relayAgentTokenProvider: RelayAgentTokenProvider;
};

function parseMode(value: string | undefined): ServerTransportMode {
	if (value?.trim().toLowerCase() === "relay") {
		return "relay";
	}

	return "local";
}

function createRelayAgentTokenProvider(relayAgentId: string): RelayAgentTokenProvider {
	return () => {
		if (relayAgentId && process.env.JWT_SECRET?.trim()) {
			return generateToken({ type: "agent", id: relayAgentId });
		}

		return process.env.PI_RELAY_AGENT_JWT?.trim() || null;
	};
}

export function getServerTransportConfig(): ServerTransportConfig {
	const relayAgentId = process.env.PI_RELAY_AGENT_ID?.trim() || "";

	return {
		mode: parseMode(process.env.PI_CONNECTION_MODE),
		relayUrl: process.env.PI_RELAY_URL?.trim() || null,
		relayAgentId,
		relayAgentTokenProvider: createRelayAgentTokenProvider(relayAgentId),
	};
}

export function assertRelayServerTransportConfig(config: ServerTransportConfig) {
	if (config.mode !== "relay") {
		return;
	}

	if (!config.relayUrl) {
		throw new Error("PI_RELAY_URL is required when PI_CONNECTION_MODE=relay");
	}

	if (!config.relayAgentId) {
		throw new Error("PI_RELAY_AGENT_ID is required when PI_CONNECTION_MODE=relay");
	}

	if (!config.relayAgentTokenProvider()) {
		throw new Error("JWT_SECRET or PI_RELAY_AGENT_JWT is required when PI_CONNECTION_MODE=relay");
	}
}
