const LOCAL_CLIENT_STORAGE_KEY = "pi-browser-local-client-id";

function createUuidFromRandomValues(): string | null {
	const cryptoApi = globalThis.crypto;
	if (!cryptoApi?.getRandomValues) {
		return null;
	}

	const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
	const versionByte = bytes[6];
	const variantByte = bytes[8];
	if (versionByte === undefined || variantByte === undefined) {
		return null;
	}

	bytes[6] = (versionByte & 0x0f) | 0x40;
	bytes[8] = (variantByte & 0x3f) | 0x80;

	const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
	return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export function createBrowserUuid(): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi?.randomUUID) {
		return cryptoApi.randomUUID();
	}

	const fallbackUuid = createUuidFromRandomValues();
	if (fallbackUuid) {
		return fallbackUuid;
	}

	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function createClientId(): string {
	return `client-${createBrowserUuid()}`;
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
