import { type RelayAgentCommand } from "@apreal/shared";

export type RelayBrowserClientConnection = {
	clientId: string;
	agentId: string;
	closed: boolean;
	send(payload: unknown): boolean;
	close(reason: string): void;
};

export type RelayAgentConnection = {
	agentId: string;
	closed: boolean;
	send(command: RelayAgentCommand): boolean;
	close(reason: string): void;
};
