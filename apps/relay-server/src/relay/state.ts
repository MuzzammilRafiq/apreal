import { RelayTokenStore } from "../token-store.ts";
import type { RelayAgentConnection, RelayBrowserClientConnection } from "../utils/types.ts";

export type RelayServerState = {
	tokenStore: RelayTokenStore;
	browserClients: Map<string, RelayBrowserClientConnection>;
	agentConnections: Map<string, RelayAgentConnection>;
};

export function createRelayServerState(): RelayServerState {
	return {
		tokenStore: new RelayTokenStore(),
		browserClients: new Map<string, RelayBrowserClientConnection>(),
		agentConnections: new Map<string, RelayAgentConnection>(),
	};
}
