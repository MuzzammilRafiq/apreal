import { type RelayAgentCommand } from "@apreal/shared";

// Runtime handle for one browser client's SSE connection through the relay.
export type RelayBrowserClientConnection = {
	clientId: string;
	agentId: string;
	closed: boolean;
	send(payload: unknown): boolean;
	close(reason: string): void;
};

// Runtime handle for one agent's SSE command stream through the relay.
export type RelayAgentConnection = {
	agentId: string;
	closed: boolean;
	send(command: RelayAgentCommand): boolean;
	close(reason: string): void;
};
