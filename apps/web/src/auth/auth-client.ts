import { PI_RELAY_URL } from "@apreal/shared";
import { createAuthClient } from "better-auth/react";

declare const __APREAL_WEB_TARGET__: "local" | "remote";


function resolveAuthBaseUrl(): string {
	return PI_RELAY_URL
}

export const authBaseUrl = resolveAuthBaseUrl();

export const authClient = createAuthClient({
	baseURL: authBaseUrl,
});

export type AuthSession = typeof authClient.$Infer.Session;
