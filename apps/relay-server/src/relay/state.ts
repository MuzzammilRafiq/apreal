import type { AuthTokenPayload } from "../auth.ts";
import { RelayOwnerBindingStore } from "../owner-binding-store.ts";
import type { RelayAgentConnection, RelayBrowserClientConnection } from "../utils/types.ts";

export type RelayServerState = {
	ownerBindingStore: RelayOwnerBindingStore;
	browserClients: Map<string, RelayBrowserClientConnection>;
	agentConnections: Map<string, RelayAgentConnection>;
	agentSessions: Map<string, AuthTokenPayload>;
};

export function createRelayServerState(): RelayServerState {
	return {
		ownerBindingStore: new RelayOwnerBindingStore(),
		browserClients: new Map<string, RelayBrowserClientConnection>(),
		agentConnections: new Map<string, RelayAgentConnection>(),
		agentSessions: new Map<string, AuthTokenPayload>(),
	};
}
