// @ts-nocheck
import { extname } from "node:path";
import { ADMIN_APPEND_SYSTEM_PROMPT_PATH, ADMIN_MCP_PATH, ADMIN_MCP_REFRESH_PATH, ADMIN_PROVIDER_API_KEY_PATH, ADMIN_PROVIDER_LOGIN_PATH, ADMIN_PROVIDERS_PATH, ADMIN_RELAY_REAUTHENTICATE_PATH, ADMIN_STATUS_PATH, CLIENT_EVENT_STREAM_PATH, CLIENT_MESSAGE_PATH, normalizeRelayPairingCode } from "@apreal/shared";
import { setDefaultProviderModel, getErrorMessage } from "../session.ts";
import { createCorsHeaders, json } from "./utils.ts";
export function createWebRequestHandler(context: any) {
	const { logger, authenticateBrowserRequest, clientManager, handleHttpClientMessage, assertLocalAdminRequest, buildStatusPayload, writeAppendSystemPrompt, recycleIdleSessionControllers, saveProviderApiKey, startProviderLogin, buildProvidersPayloadWithLoginState, cwd, readProviderLoginState, refreshMcpServers, readMcpServers, createMcpServer, rebuildCustomTools, updateMcpServer, deleteMcpServer, jobStore, sessions, scheduler, relay, createStaticResponse, createMissingWebUiResponse, webUiReady, getListeningPort } = context;
	return async (request: Request) => {
	const url = new URL(request.url);
	logger.debug("incoming request", {
		method: request.method,
		path: url.pathname,
	});
	if (url.pathname === CLIENT_EVENT_STREAM_PATH) {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}
		if (request.method !== "GET") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}
		try {
			const auth = await authenticateBrowserRequest(request);
			return clientManager.createSseStreamResponse(request, auth.clientId);
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: relay.getClientAuthErrorStatus(error), headers: createCorsHeaders() },
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
				{ status: relay.getClientAuthErrorStatus(error), headers: createCorsHeaders() },
			);
		}
	}
	if (url.pathname === ADMIN_STATUS_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}
		if (request.method !== "GET") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}
		return json(await buildStatusPayload(), {
			headers: createCorsHeaders(),
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
				headers: createCorsHeaders(),
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		const appendSystemPrompt = typeof (payload as UpdateAppendSystemPromptRequest | null)?.appendSystemPrompt === "string"
			? (payload as UpdateAppendSystemPromptRequest).appendSystemPrompt
			: null;
		if (appendSystemPrompt === null) {
			return json(
				{ message: "appendSystemPrompt must be a string." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		try {
			await writeAppendSystemPrompt(appendSystemPrompt);
			recycleIdleSessionControllers();
			const response: UpdateAppendSystemPromptResponse = {
				status: await buildStatusPayload(),
			};
			return json(response, {
				headers: createCorsHeaders(),
			});
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 500, headers: createCorsHeaders() },
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
				headers: createCorsHeaders(),
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: createCorsHeaders() },
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
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		if (!apiKey.trim()) {
			return json(
				{ message: "apiKey must be a non-empty string." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		try {
			return json(await saveProviderApiKey(provider, apiKey), { headers: createCorsHeaders() });
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 400, headers: createCorsHeaders() },
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
				headers: createCorsHeaders(),
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		const provider = typeof (payload as Partial<ProviderLoginRequest>)?.provider === "string"
			? (payload as ProviderLoginRequest).provider
			: "";
		if (!provider.trim()) {
			return json(
				{ message: "provider must be a non-empty string." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		try {
			return json(await startProviderLogin(provider), { headers: createCorsHeaders() });
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 400, headers: createCorsHeaders() },
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
				headers: createCorsHeaders(),
			});
		}
		if (request.method === "GET") {
			try {
				return json(buildProvidersPayloadWithLoginState(), { headers: createCorsHeaders() });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 500, headers: createCorsHeaders() },
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
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
				return json(
					{ message: "Request body must be a JSON object." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			const { provider, modelId } = payload as Partial<SetDefaultModelRequest>;
			if (typeof provider !== "string" || provider.trim().length === 0) {
				return json(
					{ message: "provider must be a non-empty string." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			if (typeof modelId !== "string" || modelId.trim().length === 0) {
				return json(
					{ message: "modelId must be a non-empty string." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			try {
				return json(
					await setDefaultProviderModel(cwd, provider.trim(), modelId.trim(), readProviderLoginState),
					{ headers: createCorsHeaders() },
				);
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
		}
		return new Response("Method Not Allowed", {
			status: 405,
			headers: createCorsHeaders(),
		});
	}
	if (url.pathname === ADMIN_MCP_REFRESH_PATH) {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}
		if (request.method === "POST") {
			try {
				return json(await refreshMcpServers(), { headers: createCorsHeaders() });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
		}
		return json(
			{ message: `Method ${request.method} not allowed for MCP refresh.` },
			{ status: 405, headers: createCorsHeaders() },
		);
	}
	if (url.pathname === ADMIN_MCP_PATH) {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}
		if (request.method === "GET") {
			return json(await readMcpServers(), { headers: createCorsHeaders() });
		}
		if (request.method === "POST") {
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return json(
					{ message: "The MCP server request body must be valid JSON." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			if (!payload || typeof payload !== "object") {
				return json(
					{ message: "The MCP server request body must be an object." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			try {
				await createMcpServer(payload as CreateMcpServerRequest);
				await rebuildCustomTools();
				return json(await readMcpServers(), { headers: createCorsHeaders() });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
		}
		return json(
			{ message: `Method ${request.method} not allowed for MCP servers.` },
			{ status: 405, headers: createCorsHeaders() },
		);
	}
	const adminMcpRoute = parseAdminMcpRoute(url.pathname);
	if (adminMcpRoute) {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}
		if (request.method === "PATCH") {
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return json(
					{ message: "The MCP server update body must be valid JSON." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			if (!payload || typeof payload !== "object") {
				return json(
					{ message: "The MCP server update body must be an object." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			try {
				await updateMcpServer(adminMcpRoute.serverId, payload as UpdateMcpServerRequest);
				await rebuildCustomTools();
				return json(await readMcpServers(), { headers: createCorsHeaders() });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: /not found/i.test(getErrorMessage(error)) ? 404 : 400, headers: createCorsHeaders() },
				);
			}
		}
		if (request.method === "DELETE") {
			try {
				await deleteMcpServer(adminMcpRoute.serverId);
				await rebuildCustomTools();
				return json(await readMcpServers(), { headers: createCorsHeaders() });
			} catch (error) {
				return json(
					{ message: getErrorMessage(error) },
					{ status: /not found/i.test(getErrorMessage(error)) ? 404 : 400, headers: createCorsHeaders() },
				);
			}
		}
		return json(
			{ message: `Method ${request.method} not allowed for this MCP server.` },
			{ status: 405, headers: createCorsHeaders() },
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
				headers: createCorsHeaders(),
			});
		}
		if (request.method !== "GET") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}
		return json(
			{
				jobs: jobStore.listAllJobs(),
			},
			{
				headers: createCorsHeaders(),
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
				headers: createCorsHeaders(),
			});
		}
		const job = jobStore.getJob(adminJobRoute.jobId);
		if (!job) {
			return json(
				{ message: "Scheduled job not found." },
				{ status: 404, headers: createCorsHeaders() },
			);
		}
		if (adminJobRoute.subpath === "runs") {
			if (request.method !== "GET") {
				return new Response("Method Not Allowed", {
					status: 405,
					headers: createCorsHeaders(),
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
					headers: createCorsHeaders(),
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
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
				return json(
					{ message: "Request body must be a JSON object." },
					{ status: 400, headers: createCorsHeaders() },
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
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			if (
				hasIntervalMinutes &&
				(nextIntervalMinutes === undefined || !Number.isFinite(nextIntervalMinutes) || nextIntervalMinutes < 5)
			) {
				return json(
					{ message: "intervalMinutes must be a number greater than or equal to 5." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			if (hasEnabled && typeof nextEnabled !== "boolean") {
				return json(
					{ message: "enabled must be a boolean value." },
					{ status: 400, headers: createCorsHeaders() },
				);
			}
			let updatedJob = job;
			if (hasIntervalMinutes) {
				const nextJob = jobStore.updateInterval(job.id, Math.round((nextIntervalMinutes ?? 0) * 60_000));
				if (!nextJob) {
					return json(
						{ message: "Scheduled job not found." },
						{ status: 404, headers: createCorsHeaders() },
					);
				}
				updatedJob = nextJob;
			}
			if (hasEnabled) {
				const nextJob = nextEnabled ? jobStore.resumeJob(job.id) : jobStore.pauseJob(job.id);
				if (!nextJob) {
					return json(
						{ message: "Scheduled job not found." },
						{ status: 404, headers: createCorsHeaders() },
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
					headers: createCorsHeaders(),
				},
			);
		}
		if (request.method === "DELETE") {
			jobStore.deleteJob(job.id);
			await scheduler.reschedule(job.id);
			return json(
				{ ok: true, jobId: job.id },
				{
					headers: createCorsHeaders(),
				},
			);
		}
		if (request.method === "GET") {
			return json(
				{ job },
				{
					headers: createCorsHeaders(),
				},
			);
		}
		return new Response("Method Not Allowed", {
			status: 405,
			headers: createCorsHeaders(),
		});
	}
	if (url.pathname === ADMIN_RELAY_REAUTHENTICATE_PATH) {
		const localOnlyResponse = assertLocalAdminRequest(request);
		if (localOnlyResponse) {
			return localOnlyResponse;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: createCorsHeaders(),
			});
		}
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: createCorsHeaders(),
			});
		}
		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return json(
				{ message: "Request body must be valid JSON." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		const pairingCode = normalizeRelayPairingCode(
			typeof (payload as RelayReauthenticateRequest | null)?.pairingCode === "string"
				? (payload as RelayReauthenticateRequest).pairingCode
				: null,
		);
		if (!pairingCode) {
			return json(
				{ message: "A valid pairing code is required." },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
		try {
			await relay.reauthenticateWithPairingCode(pairingCode);
			const response: RelayReauthenticateResponse = {
				status: await buildStatusPayload(),
			};
			return json(response, {
				headers: createCorsHeaders(),
			});
		} catch (error) {
			return json(
				{ message: getErrorMessage(error) },
				{ status: 400, headers: createCorsHeaders() },
			);
		}
	}
	if (url.pathname === "/health") {
		return json(await buildStatusPayload());
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
