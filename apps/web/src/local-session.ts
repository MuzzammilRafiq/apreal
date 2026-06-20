import { LOCAL_AUTH_SESSION_HEADER } from "@apreal/shared";

const LOCAL_AUTH_SESSION_STORAGE_KEY = "apreal-local-session-secret";
let volatileSessionSecret: string | null = null;

export function readLocalBrowserSessionSecret(): string | null {
	try {
		return window.localStorage.getItem(LOCAL_AUTH_SESSION_STORAGE_KEY)?.trim() || volatileSessionSecret;
	} catch {
		return volatileSessionSecret;
	}
}

export function storeLocalBrowserSessionSecret(sessionSecret: string): void {
	volatileSessionSecret = sessionSecret;
	try {
		window.localStorage.setItem(LOCAL_AUTH_SESSION_STORAGE_KEY, sessionSecret);
	} catch {
		// Keep the secret in memory when browser storage is disabled.
	}
}

export function clearStoredLocalBrowserSessionSecret(): void {
	volatileSessionSecret = null;
	try {
		window.localStorage.removeItem(LOCAL_AUTH_SESSION_STORAGE_KEY);
	} catch {
		// Storage cleanup is best-effort.
	}
}

export function localSessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const headers = new Headers(init?.headers);
	const sessionSecret = readLocalBrowserSessionSecret();
	if (sessionSecret) {
		headers.set(LOCAL_AUTH_SESSION_HEADER, sessionSecret);
	}

	return fetch(input, {
		...init,
		headers,
	});
}
