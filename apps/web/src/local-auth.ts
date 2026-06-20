import { authBaseUrl } from "./auth/auth-client";
import { requestRelayAgentOwnerGrant } from "./relay-auth";
import {
	authenticateRelayWithOwnerGrant,
	clearLocalAuthSession,
	readLocalAuthSession,
} from "./server-admin";
import {
	clearStoredLocalBrowserSessionSecret,
	storeLocalBrowserSessionSecret,
} from "./local-session";

let pendingLocalBrowserAuthSessionPromise: Promise<void> | null = null;

export async function ensureLocalBrowserAuthSession(): Promise<void> {
	if (pendingLocalBrowserAuthSessionPromise) {
		return pendingLocalBrowserAuthSessionPromise;
	}

	pendingLocalBrowserAuthSessionPromise = (async () => {
		const session = await readLocalAuthSession();
		if (session.authenticated) {
			return;
		}

		clearStoredLocalBrowserSessionSecret();
		const ownerGrant = await requestRelayAgentOwnerGrant(authBaseUrl);
		const authenticated = await authenticateRelayWithOwnerGrant(ownerGrant.ownerGrant);
		storeLocalBrowserSessionSecret(authenticated.sessionSecret);
	})().finally(() => {
		pendingLocalBrowserAuthSessionPromise = null;
	});

	return pendingLocalBrowserAuthSessionPromise;
}

export async function clearLocalBrowserAuthSession(): Promise<void> {
	try {
		await clearLocalAuthSession();
	} finally {
		clearStoredLocalBrowserSessionSecret();
	}
}
