/*
WebSocket relay client intentionally disabled.

The previous long-lived socket transport is parked while the relay moves to
stateless HTTP streaming. Keep this file as the single place to reintroduce a
server-side socket client later if needed.
*/

type LoggerLike = {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
};

type RelayAgentClientOptions = {
	relayUrl: string;
	agentId: string;
	getAgentJwt(): string;
	logger: LoggerLike;
	onClientMessage(clientId: string, payload: unknown): void;
	onDisconnect(code: number, reason: string): void;
};

export function createRelayAgentClient(options: RelayAgentClientOptions) {
	const { relayUrl, agentId, logger } = options;

	logger.info("relay websocket client disabled", {
		relayUrl,
		agentId,
	});

	return {
		dispose() {
			logger.debug("relay websocket client dispose ignored", {
				agentId,
			});
		},
		sendToClient(clientId: string, _payload: unknown) {
			logger.warn("relay websocket client send skipped because transport is disabled", {
				agentId,
				clientId,
			});
			return false;
		},
		isConnected() {
			return false;
		},
	};
}
