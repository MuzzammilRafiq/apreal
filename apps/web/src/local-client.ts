const LOCAL_CLIENT_STORAGE_KEY = "pi-browser-local-client-id";

function createClientId(): string {
	return `client-${crypto.randomUUID()}`;
}

export function readOrCreateLocalClientId(): string {
	try {
		const storedClientId = window.localStorage.getItem(LOCAL_CLIENT_STORAGE_KEY)?.trim();
		if (storedClientId) {
			return storedClientId;
		}

		const clientId = createClientId();
		window.localStorage.setItem(LOCAL_CLIENT_STORAGE_KEY, clientId);
		return clientId;
	} catch {
		return createClientId();
	}
}