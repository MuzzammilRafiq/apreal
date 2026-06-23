import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { McpServerConfig, McpServerRuntimeStatus } from "@apreal/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger } from "./logger.ts";

type Logger = ReturnType<typeof createLogger>;

type McpToolDescriptor = {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	title?: string;
};

type TextToolContent = {
	type: "text";
	text: string;
};

type ImageToolContent = {
	type: "image";
	data: string;
	mimeType: string;
};

type ToolContent = TextToolContent | ImageToolContent;

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

function toSafeToolSegment(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return normalized || "tool";
}

function buildPrefixedToolName(server: McpServerConfig, toolName: string): string {
	return `mcp_${toSafeToolSegment(server.name)}_${server.id.slice(0, 8).replace(/[^a-z0-9]/gi, "")}_${toSafeToolSegment(toolName)}`;
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function buildHeaderRecord(headers: Record<string, string>): Record<string, string> | undefined {
	return Object.keys(headers).length > 0 ? headers : undefined;
}

function mergeEnvironment(env: Record<string, string>): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") {
			merged[key] = value;
		}
	}

	for (const [key, value] of Object.entries(env)) {
		merged[key] = value;
	}

	return merged;
}

function normalizeMcpContentItem(item: unknown): ToolContent[] {
	if (!item || typeof item !== "object") {
		return [{ type: "text", text: safeJson(item) }];
	}

	const record = item as Record<string, unknown>;
	if (record.type === "text" && typeof record.text === "string") {
		return [{ type: "text", text: record.text }];
	}

	if (record.type === "image" && typeof record.data === "string" && typeof record.mimeType === "string") {
		return [{ type: "image", data: record.data, mimeType: record.mimeType }];
	}

	if (record.type === "audio") {
		return [{
			type: "text",
			text: safeJson({
				type: "audio",
				mimeType: record.mimeType,
				note: "Audio output is not rendered inline in Apreal yet.",
			}),
		}];
	}

	if (record.type === "resource" && record.resource && typeof record.resource === "object") {
		const resource = record.resource as Record<string, unknown>;
		if (typeof resource.text === "string") {
			return [{ type: "text", text: resource.text }];
		}

		return [{
			type: "text",
			text: safeJson({
				type: "resource",
				uri: resource.uri,
				mimeType: resource.mimeType,
				note: "Binary MCP resources are returned as metadata in Apreal for now.",
			}),
		}];
	}

	if (record.type === "resource_link") {
		return [{ type: "text", text: safeJson(record) }];
	}

	return [{ type: "text", text: safeJson(record) }];
}

function normalizeMcpToolResult(
	result: unknown,
	server: McpServerConfig,
	tool: McpToolDescriptor,
): { content: ToolContent[]; details: Record<string, unknown>; isError?: boolean } {
	const details: Record<string, unknown> = {
		serverId: server.id,
		serverName: server.name,
		transport: server.transport,
		toolName: tool.name,
	};

	if (!result || typeof result !== "object") {
		return {
			content: [{ type: "text", text: safeJson(result) }],
			details,
		};
	}

	const record = result as Record<string, unknown>;
	if (Array.isArray(record.content)) {
		const content = record.content.flatMap((item) => normalizeMcpContentItem(item));
		if (record.structuredContent && Object.keys(record.structuredContent as object).length > 0) {
			content.push({
				type: "text",
				text: safeJson({ structuredContent: record.structuredContent }),
			});
			details.structuredContent = record.structuredContent;
		}

		return {
			content: content.length > 0 ? content : [{ type: "text", text: "MCP tool completed with no content." }],
			details,
			isError: record.isError === true,
		};
	}

	if ("toolResult" in record) {
		details.toolResult = record.toolResult;
		return {
			content: [{ type: "text", text: safeJson(record.toolResult) }],
			details,
		};
	}

	return {
		content: [{ type: "text", text: safeJson(record) }],
		details,
		isError: record.isError === true,
	};
}

function createAbortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

class McpServerConnection {
	private client: Client | null = null;
	private transport: { close(): Promise<void> } | null = null;
	private connectPromise: Promise<Client> | null = null;

	constructor(
		private readonly server: McpServerConfig,
		private readonly cwd: string,
		private readonly logger: Logger,
		private readonly onStatusChange: (status: Partial<McpServerRuntimeStatus> & Pick<McpServerRuntimeStatus, "state">) => void,
	) {}

	private async resetConnection(closeTransport: boolean) {
		const transport = this.transport;
		this.client = null;
		this.transport = null;
		this.connectPromise = null;
		if (closeTransport && transport) {
			try {
				await transport.close();
			} catch {
				// Ignore transport shutdown races.
			}
		}
	}

	private createTransport() {
		if (this.server.transport === "stdio") {
			const transport = new StdioClientTransport({
				command: this.server.command ?? "",
				args: this.server.args,
				env: mergeEnvironment(this.server.env),
				cwd: this.cwd,
				stderr: "pipe",
			});
			transport.stderr?.on("data", (chunk: Buffer | string) => {
				const text = String(chunk).trim();
				if (!text) {
					return;
				}

				this.logger.warn("mcp server stderr", {
					server: this.server.name,
					message: text.slice(0, 500),
				});
			});
			return transport;
		}

		const url = new URL(this.server.url ?? "");
		if (this.server.transport === "sse") {
			return new SSEClientTransport(url, {
				requestInit: { headers: buildHeaderRecord(this.server.headers) },
			});
		}

		return new StreamableHTTPClientTransport(url, {
			requestInit: { headers: buildHeaderRecord(this.server.headers) },
		});
	}

	private async openConnection(): Promise<Client> {
		this.onStatusChange({ state: "connecting", lastError: null, updatedAt: Date.now() });
		const client = new Client({
			name: "Apreal MCP Bridge",
			version: "1.0.0",
		});
		const transport = this.createTransport();
		await client.connect(transport);
		transport.onerror = (error: Error) => {
			this.onStatusChange({ state: "error", lastError: getErrorMessage(error), updatedAt: Date.now() });
			this.logger.warn("mcp transport error", {
				server: this.server.name,
				error: getErrorMessage(error),
			});
		};
		transport.onclose = () => {
			void this.resetConnection(false);
			this.onStatusChange({ state: "idle", updatedAt: Date.now() });
			this.logger.info("mcp transport closed", {
				server: this.server.name,
			});
		};

		this.client = client;
		this.transport = transport;
		this.onStatusChange({ state: "ready", lastError: null, updatedAt: Date.now() });
		this.logger.info("mcp server connected", {
			server: this.server.name,
			transport: this.server.transport,
		});
		return client;
	}

	private async ensureConnected(): Promise<Client> {
		if (this.client) {
			return this.client;
		}

		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.connectPromise = this.openConnection().catch(async (error) => {
			await this.resetConnection(false);
			throw error;
		}).finally(() => {
			this.connectPromise = null;
		});

		return this.connectPromise;
	}

	private async withReconnect<T>(
		operation: (client: Client) => Promise<T>,
		options?: { signal?: AbortSignal },
	): Promise<T> {
		let attempt = 0;
		let lastError: unknown = null;
		while (attempt < 2) {
			try {
				if (options?.signal?.aborted) {
					throw createAbortError("MCP operation aborted.");
				}
				const client = await this.ensureConnected();
				return await operation(client);
			} catch (error) {
				lastError = error;
				attempt += 1;
				await this.resetConnection(true);
				if (options?.signal?.aborted) {
					throw error;
				}
				if (attempt >= 2) {
					throw error;
				}
			}
		}

		throw lastError;
	}

	async listTools(): Promise<McpToolDescriptor[]> {
		return this.withReconnect(async (client) => {
			const tools: McpToolDescriptor[] = [];
			let cursor: string | undefined;
			do {
				const response = await client.listTools(cursor ? { cursor } : undefined);
				tools.push(...response.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					title: tool.title,
				})));
				cursor = response.nextCursor;
			} while (cursor);

			this.onStatusChange({ state: "ready", toolCount: tools.length, lastError: null, updatedAt: Date.now() });

			return tools;
		});
	}

	async callTool(tool: McpToolDescriptor, args: Record<string, unknown>, signal?: AbortSignal) {
		if (signal?.aborted) {
			throw createAbortError("MCP tool call aborted.");
		}

		const closeStdioTransportForAbort = () => {
			if (this.server.transport !== "stdio") {
				return;
			}
			this.logger.warn("aborting stdio MCP tool call; closing MCP server process", {
				server: this.server.name,
				tool: tool.name,
			});
			void this.resetConnection(true);
		};
		signal?.addEventListener("abort", closeStdioTransportForAbort, { once: true });

		const result = await this.withReconnect(
			(client) =>
				client.callTool(
					{
						name: tool.name,
						arguments: args,
					},
					undefined,
					{ signal, timeout: 120_000 },
				),
			{ signal },
		).finally(() => {
			signal?.removeEventListener("abort", closeStdioTransportForAbort);
		});

		return normalizeMcpToolResult(result, this.server, tool);
	}

	async dispose() {
		await this.resetConnection(true);
	}
}

export class McpToolRegistry {
	private readonly logger: Logger;
	private readonly connections = new Map<string, McpServerConnection>();
	private readonly statuses = new Map<string, McpServerRuntimeStatus>();
	private readonly connectionKeys = new Map<string, string>();

	constructor(private readonly cwd: string, logger?: Logger) {
		this.logger = logger ?? createLogger("mcp");
	}

	private getDefaultStatus(server: McpServerConfig): McpServerRuntimeStatus {
		return {
			state: server.enabled ? "idle" : "disabled",
			toolCount: 0,
			lastError: null,
			updatedAt: null,
		};
	}

	private setStatus(serverId: string, status: Partial<McpServerRuntimeStatus> & Pick<McpServerRuntimeStatus, "state">) {
		const current = this.statuses.get(serverId) ?? {
			state: "idle",
			toolCount: 0,
			lastError: null,
			updatedAt: null,
		};
		this.statuses.set(serverId, {
			...current,
			...status,
		});
	}

	private buildConnectionKey(server: McpServerConfig): string {
		return JSON.stringify({
			transport: server.transport,
			command: server.command,
			args: server.args,
			env: server.env,
			url: server.url,
			headers: server.headers,
			enabled: server.enabled,
		});
	}

	private async getConnection(server: McpServerConfig): Promise<McpServerConnection> {
		const nextKey = this.buildConnectionKey(server);
		const previousKey = this.connectionKeys.get(server.id);
		const existing = this.connections.get(server.id);
		if (existing && previousKey === nextKey) {
			return existing;
		}

		if (existing) {
			await existing.dispose();
			this.connections.delete(server.id);
		}

		const connection = new McpServerConnection(server, this.cwd, this.logger, (status) => {
			this.setStatus(server.id, status);
		});
		this.connections.set(server.id, connection);
		this.connectionKeys.set(server.id, nextKey);
		return connection;
	}

	private async disposeRemovedConnections(activeServerIds: Set<string>) {
		for (const [serverId, connection] of this.connections) {
			if (activeServerIds.has(serverId)) {
				continue;
			}

			this.connections.delete(serverId);
			this.connectionKeys.delete(serverId);
			await connection.dispose();
		}
	}

	withRuntime(servers: McpServerConfig[]): McpServerConfig[] {
		return servers.map((server) => ({
			...server,
			runtime: server.enabled
				? (this.statuses.get(server.id) ?? this.getDefaultStatus(server))
				: {
					...(this.statuses.get(server.id) ?? this.getDefaultStatus(server)),
					state: "disabled",
					toolCount: 0,
					updatedAt: Date.now(),
				},
		}));
	}

	async buildTools(servers: McpServerConfig[]): Promise<ToolDefinition[]> {
		const activeServers = servers.filter((server) => server.enabled);
		for (const server of servers) {
			if (!server.enabled) {
				this.setStatus(server.id, { state: "disabled", toolCount: 0, updatedAt: Date.now() });
			}
		}
		await this.disposeRemovedConnections(new Set(activeServers.map((server) => server.id)));

		const tools: ToolDefinition[] = [];
		for (const server of activeServers) {
			const connection = await this.getConnection(server);
			try {
				const listedTools = await connection.listTools();
				for (const tool of listedTools) {
					tools.push(defineTool({
						name: buildPrefixedToolName(server, tool.name),
						label: `${server.name} / ${tool.title ?? tool.name}`,
						description: tool.description?.trim()
							? `${tool.description.trim()} (MCP server: ${server.name})`
							: `Tool \`${tool.name}\` exposed by MCP server \`${server.name}\`.`,
						parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema as Record<string, unknown>) as any,
						async execute(_toolCallId, params, signal) {
							return connection.callTool(tool, params as Record<string, unknown>, signal);
						},
					}));
				}
			} catch (error) {
				this.setStatus(server.id, {
					state: "error",
					toolCount: 0,
					lastError: getErrorMessage(error),
					updatedAt: Date.now(),
				});
				this.logger.warn("failed to load mcp server tools", {
					server: server.name,
					transport: server.transport,
					error: getErrorMessage(error),
				});
			}
		}

		return tools;
	}

	async disposeAll() {
		await this.disposeRemovedConnections(new Set());
	}
}
