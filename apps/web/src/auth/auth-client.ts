import { createAuthClient } from "better-auth/react";

declare const __APREAL_WEB_TARGET__: "local" | "remote";

function trimTrailingSlash(value: string): string {
	return value.replace(/\/$/, "");
}

function resolveAuthBaseUrl(): string {
	const explicitAuthUrl = import.meta.env.VITE_APREAL_AUTH_URL?.trim();
	if (explicitAuthUrl) {
		return trimTrailingSlash(explicitAuthUrl);
	}

	if (__APREAL_WEB_TARGET__ === "local") {
		const relayUrl = import.meta.env.VITE_PI_RELAY_URL?.trim();
		if (relayUrl) {
			return trimTrailingSlash(relayUrl);
		}
	}

	return window.location.origin;
}

export const authBaseUrl = resolveAuthBaseUrl();

export const authClient = createAuthClient({
	baseURL: authBaseUrl,
});

export type AuthSession = typeof authClient.$Infer.Session;
