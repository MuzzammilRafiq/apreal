import { ensureRelayAgentAuth, getRelayServerUrl } from "../relay-auth.ts";
import { getErrorMessage } from "../session.ts";
import type { Logger } from "./client-manager.ts";
import type { RelayMutableState } from "./relay.ts";

export async function initializeRelayState(logger: Logger, relayUrl = getRelayServerUrl()): Promise<RelayMutableState> {
	const relayState: RelayMutableState = {
		auth: null,
		startupError: null,
		transportConnected: false,
		transportGeneration: 0,
		transportAbortController: null,
		authenticating: false,
	};

	try {
		relayState.auth = await ensureRelayAgentAuth(logger, relayUrl);
	} catch (error) {
		relayState.startupError = getErrorMessage(error);
		logger.warn("relay registration unavailable during startup", {
			relayUrl,
			error: relayState.startupError,
		});
	}

	return relayState;
}
