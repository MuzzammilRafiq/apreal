import type { AuthTokenPayload } from "../auth.ts";
import { RelayOwnerBindingStore } from "../owner-binding-store.ts";
import type { RelayAgentConnection, RelayBrowserClientConnection } from "../utils/types.ts";

// In-memory process state for active streams plus the persistent owner-binding
// store the router consults while issuing tokens.
export type RelayServerState = {
	ownerBindingStore: RelayOwnerBindingStore;
	browserClients: Map<string, RelayBrowserClientConnection>;
	agentConnections: Map<string, RelayAgentConnection>;
	agentSessions: Map<string, AuthTokenPayload>;
};

// Creates the empty runtime state for a fresh relay process.
export function createRelayServerState(): RelayServerState {
	return {
		ownerBindingStore: new RelayOwnerBindingStore(),
		browserClients: new Map<string, RelayBrowserClientConnection>(),
		agentConnections: new Map<string, RelayAgentConnection>(),
		agentSessions: new Map<string, AuthTokenPayload>(),
	};
}
