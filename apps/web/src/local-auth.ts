import { authBaseUrl } from "./auth/auth-client";
import { requestRelayAgentOwnerGrant } from "./relay-auth";
import {
	authenticateRelayWithOwnerGrant,
	clearLocalAuthSession,
	readLocalAuthSession,
} from "./server-admin";

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

		const ownerGrant = await requestRelayAgentOwnerGrant(authBaseUrl);
		await authenticateRelayWithOwnerGrant(ownerGrant.ownerGrant);
	})().finally(() => {
		pendingLocalBrowserAuthSessionPromise = null;
	});

	return pendingLocalBrowserAuthSessionPromise;
}

export async function clearLocalBrowserAuthSession(): Promise<void> {
	await clearLocalAuthSession();
}
