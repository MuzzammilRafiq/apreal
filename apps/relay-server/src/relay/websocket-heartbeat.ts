import { WebSocket } from "ws";

export type WebSocketHeartbeatOptions = {
	intervalMs: number;
	pongTimeoutMs: number;
	onTimeout: () => void;
	onError: (error: Error) => void;
};

// WebSocket OPEN only describes local state. A peer can disappear without a
// close frame, so require a pong for every ping and retire silent sockets.
export function startWebSocketHeartbeat(
	ws: WebSocket,
	options: WebSocketHeartbeatOptions,
): () => void {
	let stopped = false;
	let pongTimer: ReturnType<typeof setTimeout> | null = null;

	const clearPongTimer = () => {
		if (pongTimer) {
			clearTimeout(pongTimer);
			pongTimer = null;
		}
	};

	const handlePong = () => {
		clearPongTimer();
	};

	const ping = () => {
		if (stopped || ws.readyState !== WebSocket.OPEN || pongTimer) {
			return;
		}

		pongTimer = setTimeout(() => {
			pongTimer = null;
			if (!stopped) {
				options.onTimeout();
			}
		}, options.pongTimeoutMs);
		pongTimer.unref();

		try {
			ws.ping(undefined, undefined, (error) => {
				if (!error || stopped) {
					return;
				}

				clearPongTimer();
				options.onError(error);
			});
		} catch (error) {
			clearPongTimer();
			options.onError(error instanceof Error ? error : new Error(String(error)));
		}
	};

	ws.on("pong", handlePong);
	const heartbeatTimer = setInterval(ping, options.intervalMs);
	heartbeatTimer.unref();

	return () => {
		if (stopped) {
			return;
		}

		stopped = true;
		clearInterval(heartbeatTimer);
		clearPongTimer();
		ws.off("pong", handlePong);
	};
}
