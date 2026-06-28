import { extname } from "node:path";
import {
	ADMIN_APPEND_SYSTEM_PROMPT_PATH,
	ADMIN_MCP_PATH,
	ADMIN_MCP_REFRESH_PATH,
	ADMIN_PROVIDER_API_KEY_PATH,
	ADMIN_PROVIDER_LOGIN_PATH,
	ADMIN_PROVIDERS_PATH,
	ADMIN_RELAY_AUTHENTICATE_PATH,
	ADMIN_STATUS_PATH,
	CLIENT_EVENT_STREAM_PATH,
	CLIENT_MESSAGE_PATH,
	CreateMcpServerRequestSchema,
	LOCAL_AUTH_SESSION_PATH,
	ProviderApiKeyRequestSchema,
	ProviderLoginRequestSchema,
	RelayAuthenticateRequestSchema,
	SetDefaultModelRequestSchema,
	UpdateAppendSystemPromptRequestSchema,
	UpdateMcpServerRequestSchema,
	type CreateMcpServerRequest,
	type LocalAuthSessionResponse,
	type LocalWebAdminStatus,
	type McpServersResponse,
	type ProviderApiKeyRequest,
	type ProviderLoginRequest,
	type ProviderLoginState,
	type ProvidersResponse,
	type RelayAuthenticateResponse,
	type SetDefaultModelRequest,
	type UpdateAppendSystemPromptRequest,
	type UpdateAppendSystemPromptResponse,
	type UpdateMcpServerRequest,
} from "@apreal/shared";
import type { z } from "zod";
import { setDefaultProviderModel, getErrorMessage } from "../session.ts";
import { createCorsHeaders, getCorsOriginErrorMessage, json } from "./utils.ts";
import type { ClientActions, Logger } from "./client-manager.ts";
import type { SharedSessionState } from "./session-state.ts";
import type { JobStore, Scheduler } from "../scheduled-jobs/index.ts";
import {
	createClearedLocalBrowserAuthSessionCookieHeader,
	createLocalBrowserAuthSession,
	hasLocalBrowserAuthSession,
} from "./local-browser-auth.ts";

type AdminJobRoute = { jobId: string; subpath: "runs" | null };
type AdminMcpRoute = { serverId: string };

type WebRelay = {
	authenticateWithOwnerGrant(ownerGrant: string): Promise<unknown>;
	getClientAuthErrorStatus(error: unknown): number;
	isConfigured(): boolean;
};

type WebRequestHandlerContext = {
	logger: Logger;
	authenticateBrowserRequest(request: Request): Promise<{ clientId: string }>;
	clientManager: ClientActions;
	handleHttpClientMessage(request: Request, clientId: string): Promise<Response>;
	assertLocalAdminRequest(request: Request): Response | null;
	assertLocalBrowserLocation(request: Request): Response | null;
	buildStatusPayload(): Promise<LocalWebAdminStatus>;
	writeAppendSystemPrompt(value: string): Promise<void>;
	recycleIdleSessionControllers(): void;
	saveProviderApiKey(provider: string, apiKey: string): Promise<unknown>;
	startProviderLogin(provider: string): Promise<unknown>;
	buildProvidersPayloadWithLoginState(): ProvidersResponse;
	cwd: string;
	readProviderLoginState(providerId: string): ProviderLoginState | null;
	refreshMcpServers(): Promise<McpServersResponse>;
	readMcpServers(): Promise<McpServersResponse>;
	createMcpServer(requestBody: CreateMcpServerRequest): Promise<McpServersResponse>;
	updateMcpServer(serverId: string, requestBody: UpdateMcpServerRequest): Promise<McpServersResponse>;
	deleteMcpServer(serverId: string): Promise<McpServersResponse>;
	ADMIN_JOBS_PATH: string;
	parseAdminMcpRoute(pathname: string): AdminMcpRoute | null;
	parseAdminJobRoute(pathname: string): AdminJobRoute | null;
	listScheduledJobRuns(jobName: string, sessions: Map<string, SharedSessionState>): unknown[];
	jobStore: JobStore;
	sessions: Map<string, SharedSessionState>;
	scheduler: Scheduler;
	relay: WebRelay;
	createStaticResponse(request: Request, url: URL): Promise<Response | null>;
	createMissingWebUiResponse(request: Request, port: number): Response;
	webUiReady: boolean;
	getListeningPort(): number;
};

async function readJsonRequest<TSchema extends z.ZodType>(
	request: Request,
	schema: TSchema,
	invalidJsonMessage: string,
	invalidPayloadMessage: string,
): Promise<{ ok: true; data: z.infer<TSchema> } | { ok: false; response: Response }> {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return {
			ok: false,
			response: json({ message: invalidJsonMessage }, { status: 400, headers: createCorsHeaders(request) }),
		};
	}

	const result = schema.safeParse(payload);
	if (!result.success) {
		return {
			ok: false,
			response: json({ message: invalidPayloadMessage }, { status: 400, headers: createCorsHeaders(request) }),
		};
	}

	return { ok: true, data: result.data };
}

export function createWebRequestHandler(context: WebRequestHandlerContext) {
	const { logger, authenticateBrowserRequest, clientManager, handleHttpClientMessage, assertLocalAdminRequest, assertLocalBrowserLocation, buildStatusPayload, writeAppendSystemPrompt, recycleIdleSessionControllers, saveProviderApiKey, startProviderLogin, buildProvidersPayloadWithLoginState, cwd, readProviderLoginState, refreshMcpServers, readMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, ADMIN_JOBS_PATH, parseAdminMcpRoute, parseAdminJobRoute, listScheduledJobRuns, jobStore, sessions, scheduler, relay, createStaticResponse, createMissingWebUiResponse, webUiReady, getListeningPort } = context;
	return async (request: Request) => {
	const url = new URL(request.url);
	const corsHeaders = createCorsHeaders(request);
	logger.debug("incoming request", {
		method: request.method,
		path: url.pathname,
	});
	if (url.pathname.startsWith("/api/")) {
		const corsOriginError = getCorsOriginErrorMessage(request);
		if (corsOriginError) {
			return json({ message: corsOriginError }, { status: 403, headers: corsHeaders });
		}
	}
	if (url.pathname === CLIENT_EVENT_STREAM_PATH) {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method !== "GET") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}
		try {
			const auth = await authenticateBrowserRequest(request);
			return clientManager.createSseStreamResponse(request, auth.clientId);
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: relay.getClientAuthErrorStatus(error), headers: corsHeaders },
			);
		}
	}
	if (url.pathname === CLIENT_MESSAGE_PATH) {
		try {
			const auth = await authenticateBrowserRequest(request);
			return handleHttpClientMessage(request, auth.clientId);
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: relay.getClientAuthErrorStatus(error), headers: corsHeaders },
			);
		}
	}
	if (url.pathname === LOCAL_AUTH_SESSION_PATH) {
		const localOnlyResponse = assertLocalBrowserLocation(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method === "GET") {
			const response: LocalAuthSessionResponse = {
				authenticated: hasLocalBrowserAuthSession(request),
			};
			return json(response, {
				headers: corsHeaders,
			});
		}
		if (request.method === "DELETE") {
			if (!hasLocalBrowserAuthSession(request)) {
				return json(
					{ message: "A valid local browser session is required." },
					{ status: 401, headers: corsHeaders },
				);
			}
			return json(
				{ ok: true },
				{
					headers: {
						...corsHeaders,
						"set-cookie": createClearedLocalBrowserAuthSessionCookieHeader(),
					},
				},
			);
		}
		return new Response("Method Not Allowed", {
			status: 405,
			headers: corsHeaders,
		});
	}
	if (url.pathname === ADMIN_STATUS_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method !== "GET") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}
		return json(await buildStatusPayload(), {
			headers: corsHeaders,
		});
	}
	if (url.pathname === ADMIN_APPEND_SYSTEM_PROMPT_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}
		const payload = await readJsonRequest(
			request,
			UpdateAppendSystemPromptRequestSchema,
			"Request body must be valid JSON.",
			"appendSystemPrompt must be a string.",
		);
		if (!payload.ok) {
			return payload.response;
		}
		const appendSystemPrompt: UpdateAppendSystemPromptRequest["appendSystemPrompt"] = payload.data.appendSystemPrompt;
		try {
			await writeAppendSystemPrompt(appendSystemPrompt);
			recycleIdleSessionControllers();
			const response: UpdateAppendSystemPromptResponse = {
				status: await buildStatusPayload(),
			};
			return json(response, {
				headers: corsHeaders,
			});
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 500, headers: corsHeaders },
			);
		}
	}
	if (url.pathname === ADMIN_PROVIDER_API_KEY_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}
		const payload = await readJsonRequest(
			request,
			ProviderApiKeyRequestSchema,
			"Request body must be valid JSON.",
			"provider and apiKey must be non-empty strings.",
		);
		if (!payload.ok) {
			return payload.response;
		}
		const { provider, apiKey }: ProviderApiKeyRequest = payload.data;
		try {
			return json(await saveProviderApiKey(provider, apiKey), { headers: corsHeaders });
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 400, headers: corsHeaders },
			);
		}
	}
	if (url.pathname === ADMIN_PROVIDER_LOGIN_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}
		const payload = await readJsonRequest(
			request,
			ProviderLoginRequestSchema,
			"Request body must be valid JSON.",
			"provider must be a non-empty string.",
		);
		if (!payload.ok) {
			return payload.response;
		}
		const { provider }: ProviderLoginRequest = payload.data;
		try {
			return json(await startProviderLogin(provider), { headers: corsHeaders });
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 400, headers: corsHeaders },
			);
		}
	}
	if (url.pathname === ADMIN_PROVIDERS_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method === "GET") {
			try {
				return json(buildProvidersPayloadWithLoginState(), { headers: corsHeaders });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}
		if (request.method === "PATCH") {
			const payload = await readJsonRequest(
				request,
				SetDefaultModelRequestSchema,
				"Request body must be valid JSON.",
				"provider and modelId must be non-empty strings.",
			);
			if (!payload.ok) {
				return payload.response;
			}
			const { provider, modelId }: SetDefaultModelRequest = payload.data;
			try {
				const providersPayload = await setDefaultProviderModel(
					cwd,
					provider,
					modelId,
					readProviderLoginState,
				);
				recycleIdleSessionControllers();
				return json(
					providersPayload,
					{ headers: corsHeaders },
				);
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 400, headers: corsHeaders },
				);
			}
		}
		return new Response("Method Not Allowed", {
			status: 405,
			headers: corsHeaders,
		});
	}
	if (url.pathname === ADMIN_MCP_REFRESH_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method === "POST") {
			try {
				return json(await refreshMcpServers(), { headers: corsHeaders });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 400, headers: corsHeaders },
				);
			}
		}
		return json(
			{ message: `Method ${request.method} not allowed for MCP refresh.` },
			{ status: 405, headers: corsHeaders },
		);
	}
	if (url.pathname === ADMIN_MCP_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method === "GET") {
			return json(await readMcpServers(), { headers: corsHeaders });
		}
		if (request.method === "POST") {
			const payload = await readJsonRequest(
				request,
				CreateMcpServerRequestSchema,
				"The MCP server request body must be valid JSON.",
				"The MCP server request body is invalid.",
			);
			if (!payload.ok) {
				return payload.response;
			}
			try {
				await createMcpServer(payload.data);
				return json(await readMcpServers(), { headers: corsHeaders });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 400, headers: corsHeaders },
				);
			}
		}
		return json(
			{ message: `Method ${request.method} not allowed for MCP servers.` },
			{ status: 405, headers: corsHeaders },
		);
	}
	const adminMcpRoute = parseAdminMcpRoute(url.pathname);
	if (adminMcpRoute) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method === "PATCH") {
			const payload = await readJsonRequest(
				request,
				UpdateMcpServerRequestSchema,
				"The MCP server update body must be valid JSON.",
				"The MCP server update body is invalid.",
			);
			if (!payload.ok) {
				return payload.response;
			}
			try {
				await updateMcpServer(adminMcpRoute.serverId, payload.data);
				return json(await readMcpServers(), { headers: corsHeaders });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: /not found/i.test(getErrorMessage(error)) ? 404 : 400, headers: corsHeaders },
				);
			}
		}
		if (request.method === "DELETE") {
			try {
				await deleteMcpServer(adminMcpRoute.serverId);
				return json(await readMcpServers(), { headers: corsHeaders });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: /not found/i.test(getErrorMessage(error)) ? 404 : 400, headers: corsHeaders },
				);
			}
		}
		return json(
			{ message: `Method ${request.method} not allowed for this MCP server.` },
			{ status: 405, headers: corsHeaders },
		);
	}
	if (url.pathname === ADMIN_JOBS_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method !== "GET") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}
		return json(
			{
				jobs: jobStore.listAllJobs(),
			},
			{
				headers: corsHeaders,
			},
		);
	}
	const adminJobRoute = parseAdminJobRoute(url.pathname);
	if (adminJobRoute) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		const job = jobStore.getJob(adminJobRoute.jobId);
		if (!job) {
			return json(
				{ message: "Scheduled job not found." },
				{ status: 404, headers: corsHeaders },
			);
		}
		if (adminJobRoute.subpath === "runs") {
			if (request.method !== "GET") {
				return new Response("Method Not Allowed", {
					status: 405,
					headers: corsHeaders,
				});
			}
			const runs = listScheduledJobRuns(job.name, sessions);
			return json(
				{
					jobId: job.id,
					jobName: job.name,
					count: runs.length,
					runs,
				},
				{
					headers: corsHeaders,
				},
			);
		}
		if (request.method === "PATCH") {
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return json(
					{ message: "Request body must be valid JSON." },
					{ status: 400, headers: corsHeaders },
				);
			}
			if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
				return json(
					{ message: "Request body must be a JSON object." },
					{ status: 400, headers: corsHeaders },
				);
			}
			const hasIntervalMinutes = "intervalMinutes" in payload;
			const nextIntervalMinutes = hasIntervalMinutes
				? Number((payload as Record<string, unknown>).intervalMinutes)
				: undefined;
			const hasEnabled = "enabled" in payload;
			const nextEnabled = hasEnabled ? (payload as Record<string, unknown>).enabled : null;
			if (!hasIntervalMinutes && !hasEnabled) {
				return json(
					{ message: "At least one job setting must be provided." },
					{ status: 400, headers: corsHeaders },
				);
			}
			if (
				hasIntervalMinutes &&
				(nextIntervalMinutes === undefined || !Number.isFinite(nextIntervalMinutes) || nextIntervalMinutes < 5)
			) {
				return json(
					{ message: "intervalMinutes must be a number greater than or equal to 5." },
					{ status: 400, headers: corsHeaders },
				);
			}
			if (hasEnabled && typeof nextEnabled !== "boolean") {
				return json(
					{ message: "enabled must be a boolean value." },
					{ status: 400, headers: corsHeaders },
				);
			}
			let updatedJob = job;
			if (hasIntervalMinutes) {
				const nextJob = jobStore.updateInterval(job.id, Math.round((nextIntervalMinutes ?? 0) * 60_000));
				if (!nextJob) {
					return json(
						{ message: "Scheduled job not found." },
						{ status: 404, headers: corsHeaders },
					);
				}
				updatedJob = nextJob;
			}
			if (hasEnabled) {
				const nextJob = nextEnabled ? jobStore.resumeJob(job.id) : jobStore.pauseJob(job.id);
				if (!nextJob) {
					return json(
						{ message: "Scheduled job not found." },
						{ status: 404, headers: corsHeaders },
					);
				}
				updatedJob = nextJob;
			}
			if (updatedJob.enabled) {
				scheduler.scheduleJob(updatedJob);
			} else {
				await scheduler.reschedule(updatedJob.id);
			}
			return json(
				{ job: updatedJob },
				{
					headers: corsHeaders,
				},
			);
		}
		if (request.method === "DELETE") {
			jobStore.deleteJob(job.id);
			await scheduler.reschedule(job.id);
			return json(
				{ ok: true, jobId: job.id },
				{
					headers: corsHeaders,
				},
			);
		}
		if (request.method === "GET") {
			return json(
				{ job },
				{
					headers: corsHeaders,
				},
			);
		}
		return new Response("Method Not Allowed", {
			status: 405,
			headers: corsHeaders,
		});
	}
	if (url.pathname === ADMIN_RELAY_AUTHENTICATE_PATH) {
		const localOnlyResponse = assertLocalBrowserLocation(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: corsHeaders,
			});
		}
		const payload = await readJsonRequest(
			request,
			RelayAuthenticateRequestSchema,
			"Request body must be valid JSON.",
			"A signed-in account grant is required.",
		);
		if (!payload.ok) {
			return payload.response;
		}
		const { ownerGrant } = payload.data;
		try {
			await relay.authenticateWithOwnerGrant(ownerGrant);
			const localSession = createLocalBrowserAuthSession();
			const response: RelayAuthenticateResponse = {
				status: await buildStatusPayload(),
				sessionSecret: localSession.sessionSecret,
			};
			return json(response, {
				headers: {
					...corsHeaders,
					"set-cookie": localSession.cookieHeader,
				},
			});
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 400, headers: corsHeaders },
			);
		}
	}
	if (url.pathname === "/health") {
		return json({
			service: "web-server",
			status: "ok",
			transport: "http-sse+relay",
			port: getListeningPort(),
			webUiReady,
			relayReady: relay.isConfigured(),
			timestamp: new Date().toISOString(),
		});
	}
	if (!url.pathname.startsWith("/api/")) {
		const staticResponse = await createStaticResponse(request, url);
		if (staticResponse) {
			return staticResponse;
		}
		const normalizedRelativePath = url.pathname === "/"
			? "index.html"
			: url.pathname.replace(/^\/+/, "");
		if (!webUiReady && (url.pathname === "/" || !extname(normalizedRelativePath))) {
			return createMissingWebUiResponse(request, getListeningPort());
		}
	}
	return new Response("Not Found", { status: 404 });
	};
}
