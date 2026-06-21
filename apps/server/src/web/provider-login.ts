import { AuthStorage } from "@earendil-works/pi-coding-agent";
import type {
	ProviderApiKeyResponse,
	ProviderLoginResponse,
	ProviderLoginState,
	ProvidersResponse,
} from "@apreal/shared";
import { buildProvidersPayload, getErrorMessage } from "../session.ts";
import type { Logger } from "./client-manager.ts";

function createIdleProviderLoginState(): ProviderLoginState {
	return {
		status: "idle",
		authUrl: null,
		error: null,
		updatedAt: null,
	};
}

type ProviderLoginAttempt = {
	provider: string;
	state: ProviderLoginState;
	authUrlPromise: Promise<string>;
	resolveAuthUrl: (authUrl: string) => void;
	rejectAuthUrl: (error: unknown) => void;
};

function createProviderLoginAttempt(provider: string): ProviderLoginAttempt {
	let resolveAuthUrl = (_authUrl: string) => {};
	let rejectAuthUrl = (_error: unknown) => {};
	const authUrlPromise = new Promise<string>((resolve, reject) => {
		resolveAuthUrl = resolve;
		rejectAuthUrl = reject;
	});

	return {
		provider,
		state: {
			status: "pending",
			authUrl: null,
			error: null,
			updatedAt: Date.now(),
		},
		authUrlPromise,
		resolveAuthUrl,
		rejectAuthUrl,
	};
}

export function createProviderLoginManager({
	authPath,
	cwd,
	logger,
}: {
	authPath: string;
	cwd: string;
	logger: Logger;
}) {
	const providerLoginAttempts = new Map<string, ProviderLoginAttempt>();
	const readProviderLoginState = (providerId: string): ProviderLoginState | null =>
		providerLoginAttempts.get(providerId)?.state ?? null;
	const buildProvidersPayloadWithLoginState = (): ProvidersResponse => buildProvidersPayload(cwd, readProviderLoginState);

	const startProviderLogin = async (providerId: string): Promise<ProviderLoginResponse> => {
		const normalizedProviderId = providerId.trim();
		if (!normalizedProviderId) {
			throw new Error("provider must be a non-empty string.");
		}

		const authStorage = AuthStorage.create(authPath);
		const oauthProvider = authStorage.getOAuthProviders().find((provider) => provider.id === normalizedProviderId);
		if (!oauthProvider) {
			throw new Error(`Provider ${normalizedProviderId} does not support Pi OAuth login.`);
		}

		const existingAttempt = providerLoginAttempts.get(normalizedProviderId);
		if (existingAttempt?.state.status === "pending") {
			return {
				...buildProvidersPayloadWithLoginState(),
				provider: normalizedProviderId,
				loginState: existingAttempt.state,
			};
		}

		const attempt = createProviderLoginAttempt(normalizedProviderId);
		providerLoginAttempts.set(normalizedProviderId, attempt);

		void authStorage.login(normalizedProviderId, {
			onAuth: (info) => {
				attempt.state = {
					status: "pending",
					authUrl: info.url,
					error: null,
					updatedAt: Date.now(),
				};
				attempt.resolveAuthUrl(info.url);
			},
			onDeviceCode: (info) => {
				throw new Error(
					"Provider " + normalizedProviderId + " requested device-code login (" + info.verificationUri + ", code " + info.userCode + "). Web login currently supports browser-based Pi OAuth only.",
				);
			},
			onPrompt: async (prompt) => {
				throw new Error(
					`Provider ${normalizedProviderId} requested extra input (${prompt.message}). Web login currently supports browser-based Pi OAuth only.`,
				);
			},
			onSelect: async (prompt) => {
				throw new Error(
					`Provider ${normalizedProviderId} requires an interactive selection (${prompt.message}). Web login currently supports browser-based Pi OAuth only.`,
				);
			},
			onProgress: (message) => {
				logger.info("provider login progress", {
					provider: normalizedProviderId,
					message,
				});
			},
		})
			.then(() => {
				attempt.state = {
					status: "succeeded",
					authUrl: null,
					error: null,
					updatedAt: Date.now(),
				};
			})
			.catch((error) => {
				const message = getErrorMessage(error);
				attempt.state = {
					status: "failed",
					authUrl: null,
					error: message,
					updatedAt: Date.now(),
				};
				attempt.rejectAuthUrl(error);
				logger.warn("provider login failed", {
					provider: normalizedProviderId,
					error: message,
				});
			});

		try {
			await attempt.authUrlPromise;
		} catch (error) {
			throw new Error(getErrorMessage(error));
		}

		return {
			...buildProvidersPayloadWithLoginState(),
			provider: normalizedProviderId,
			loginState: attempt.state,
		};
	};

	const saveProviderApiKey = async (providerId: string, apiKey: string): Promise<ProviderApiKeyResponse> => {
		const normalizedProviderId = providerId.trim();
		const normalizedApiKey = apiKey.trim();
		if (!normalizedProviderId) {
			throw new Error("provider must be a non-empty string.");
		}
		if (!normalizedApiKey) {
			throw new Error("apiKey must be a non-empty string.");
		}

		const authStorage = AuthStorage.create(authPath);
		authStorage.set(normalizedProviderId, {
			type: "api_key",
			key: normalizedApiKey,
		});

		const loginAttempt = providerLoginAttempts.get(normalizedProviderId);
		if (loginAttempt) {
			loginAttempt.state = createIdleProviderLoginState();
		}

		return {
			...buildProvidersPayloadWithLoginState(),
			provider: normalizedProviderId,
		};
	};

	return {
		buildProvidersPayloadWithLoginState,
		readProviderLoginState,
		saveProviderApiKey,
		startProviderLogin,
	};
}
