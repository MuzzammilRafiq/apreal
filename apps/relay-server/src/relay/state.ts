import type { AuthTokenPayload } from "../auth/relay-token.ts";
import { RelayCredentialStore } from "../storage/credential-store.ts";
import { RelayOwnerBindingStore } from "../storage/owner-binding-store.ts";
import type { RelayAgentConnection, RelayBrowserClientConnection } from "./connection-types.ts";

// In-memory process state for active streams plus the persistent owner-binding
// store the router consults while issuing tokens.
export type RelayServerState = {
	ownerBindingStore: RelayOwnerBindingStore;
	credentialStore: RelayCredentialStore;
	browserClients: Map<string, RelayBrowserClientConnection>;
	agentConnections: Map<string, RelayAgentConnection>;
	agentSessions: Map<string, AuthTokenPayload>;
};

// Creates the empty runtime state for a fresh relay process.
export function createRelayServerState(): RelayServerState {
	return {
		ownerBindingStore: new RelayOwnerBindingStore(),
		credentialStore: new RelayCredentialStore(),
		browserClients: new Map<string, RelayBrowserClientConnection>(),
		agentConnections: new Map<string, RelayAgentConnection>(),
		agentSessions: new Map<string, AuthTokenPayload>(),
	};
}
