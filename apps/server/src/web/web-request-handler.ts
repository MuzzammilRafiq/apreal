// @ts-nocheck
import { extname } from "node:path";
import { ADMIN_APPEND_SYSTEM_PROMPT_PATH, ADMIN_MCP_PATH, ADMIN_MCP_REFRESH_PATH, ADMIN_PROVIDER_API_KEY_PATH, ADMIN_PROVIDER_LOGIN_PATH, ADMIN_PROVIDERS_PATH, ADMIN_RELAY_AUTHENTICATE_PATH, ADMIN_STATUS_PATH, CLIENT_EVENT_STREAM_PATH, CLIENT_MESSAGE_PATH, LOCAL_AUTH_SESSION_PATH, type LocalAuthSessionResponse, type RelayAuthenticateRequest, type RelayAuthenticateResponse } from "@apreal/shared";
import { setDefaultProviderModel, getErrorMessage } from "../session.ts";
import { createCorsHeaders, getCorsOriginErrorMessage, json } from "./utils.ts";
import {
	createClearedLocalBrowserAuthSessionCookieHeader,
	createLocalBrowserAuthSessionCookieHeader,
	hasLocalBrowserAuthSession,
} from "./local-browser-auth.ts";
export function createWebRequestHandler(context: any) {
	const { logger, authenticateBrowserRequest, clientManager, handleHttpClientMessage, assertLocalAdminRequest, buildStatusPayload, writeAppendSystemPrompt, recycleIdleSessionControllers, saveProviderApiKey, startProviderLogin, buildProvidersPayloadWithLoginState, cwd, readProviderLoginState, refreshMcpServers, readMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, ADMIN_JOBS_PATH, parseAdminMcpRoute, parseAdminJobRoute, listScheduledJobRuns, jobStore, sessions, scheduler, relay, createStaticResponse, createMissingWebUiResponse, webUiReady, getListeningPort } = context;
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
			const response: LocalAuthSessionResponse = {
				authenticated: hasLocalBrowserAuthSession(request),
			};
			return json(response, {
				headers: corsHeaders,
			});
		}
		if (request.method === "DELETE") {
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
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: corsHeaders },
			);
		}
		const appendSystemPrompt = typeof (payload as UpdateAppendSystemPromptRequest | null)?.appendSystemPrompt === "string"
			? (payload as UpdateAppendSystemPromptRequest).appendSystemPrompt
			: null;
		if (appendSystemPrompt === null) {
			return json(
				{ message: "appendSystemPrompt must be a string." },
				{ status: 400, headers: corsHeaders },
			);
		}
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
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: corsHeaders },
			);
		}
		const provider = typeof (payload as Partial<ProviderApiKeyRequest>)?.provider === "string"
			? (payload as ProviderApiKeyRequest).provider
			: "";
		const apiKey = typeof (payload as Partial<ProviderApiKeyRequest>)?.apiKey === "string"
			? (payload as ProviderApiKeyRequest).apiKey
			: "";
		if (!provider.trim()) {
			return json(
				{ message: "provider must be a non-empty string." },
				{ status: 400, headers: corsHeaders },
			);
		}
		if (!apiKey.trim()) {
			return json(
				{ message: "apiKey must be a non-empty string." },
				{ status: 400, headers: corsHeaders },
			);
		}
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
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: corsHeaders },
			);
		}
		const provider = typeof (payload as Partial<ProviderLoginRequest>)?.provider === "string"
			? (payload as ProviderLoginRequest).provider
			: "";
		if (!provider.trim()) {
			return json(
				{ message: "provider must be a non-empty string." },
				{ status: 400, headers: corsHeaders },
			);
		}
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
			const { provider, modelId } = payload as Partial<SetDefaultModelRequest>;
			if (typeof provider !== "string" || provider.trim().length === 0) {
				return json(
					{ message: "provider must be a non-empty string." },
					{ status: 400, headers: corsHeaders },
				);
			}
			if (typeof modelId !== "string" || modelId.trim().length === 0) {
				return json(
					{ message: "modelId must be a non-empty string." },
					{ status: 400, headers: corsHeaders },
				);
			}
			try {
				const providersPayload = await setDefaultProviderModel(
					cwd,
					provider.trim(),
					modelId.trim(),
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
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return json(
					{ message: "The MCP server request body must be valid JSON." },
					{ status: 400, headers: corsHeaders },
				);
			}
			if (!payload || typeof payload !== "object") {
				return json(
					{ message: "The MCP server request body must be an object." },
					{ status: 400, headers: corsHeaders },
				);
			}
			try {
				await createMcpServer(payload as CreateMcpServerRequest);
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
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return json(
					{ message: "The MCP server update body must be valid JSON." },
					{ status: 400, headers: corsHeaders },
				);
			}
			if (!payload || typeof payload !== "object") {
				return json(
					{ message: "The MCP server update body must be an object." },
					{ status: 400, headers: corsHeaders },
				);
			}
			try {
				await updateMcpServer(adminMcpRoute.serverId, payload as UpdateMcpServerRequest);
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
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: corsHeaders },
			);
		}
		const ownerGrant = typeof (payload as RelayAuthenticateRequest | null)?.ownerGrant === "string"
			? (payload as RelayAuthenticateRequest).ownerGrant.trim()
			: "";
		if (!ownerGrant) {
			return json(
				{ message: "A signed-in account grant is required." },
				{ status: 400, headers: corsHeaders },
			);
		}
		try {
			await relay.authenticateWithOwnerGrant(ownerGrant);
			const response: RelayAuthenticateResponse = {
				status: await buildStatusPayload(),
			};
			return json(response, {
				headers: {
					...corsHeaders,
					"set-cookie": createLocalBrowserAuthSessionCookieHeader(),
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
