import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	CreateMcpServerRequest,
	McpServerConfig,
	McpServerOrigin,
	McpServerTransport,
	McpServersResponse,
	UpdateMcpServerRequest,
} from "@apreal/shared";

type McpStorePayload = {
	servers: McpServerConfig[];
};

export type BuiltInMcpServerDefinition = Omit<McpServerConfig, "createdAt" | "updatedAt" | "runtime" | "origin">;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTransport(value: unknown): value is McpServerTransport {
	return value === "stdio" || value === "http" || value === "sse";
}

function isOrigin(value: unknown): value is McpServerOrigin {
	return value === "user" || value === "built_in";
}

function normalizeStringRecord(value: unknown, label: string): Record<string, string> {
	if (value === undefined || value === null) {
		return {};
	}

	if (!isObjectRecord(value)) {
		throw new Error(`${label} must be an object.`);
	}

	const normalized: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		const normalizedKey = key.trim();
		if (!normalizedKey) {
			throw new Error(`${label} keys must be non-empty strings.`);
		}
		if (typeof entry !== "string") {
			throw new Error(`${label} values must be strings.`);
		}
		normalized[normalizedKey] = entry;
	}

	return normalized;
}

function normalizeArgs(value: unknown): string[] {
	if (value === undefined || value === null) {
		return [];
	}

	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		throw new Error("args must be an array of strings.");
	}

	return value
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function normalizeOptionalString(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		throw new Error("Expected a string value.");
	}

	const normalized = value.trim();
	return normalized || null;
}

function validateUrl(value: string | null, transport: McpServerTransport) {
	if (transport === "stdio") {
		return;
	}

	if (!value) {
		throw new Error("A URL is required for HTTP and SSE MCP servers.");
	}

	try {
		new URL(value);
	} catch {
		throw new Error("MCP server URL must be a valid absolute URL.");
	}
}

function validateCommand(value: string | null, transport: McpServerTransport) {
	if (transport !== "stdio") {
		return;
	}

	if (!value) {
		throw new Error("A command is required for stdio MCP servers.");
	}
}

function sortServers(servers: McpServerConfig[]): McpServerConfig[] {
	return [...servers].sort((left, right) =>
		Number(right.enabled) - Number(left.enabled) ||
		left.name.localeCompare(right.name) ||
		left.id.localeCompare(right.id),
	);
}

function normalizeServerPayload(
	payload: CreateMcpServerRequest | UpdateMcpServerRequest,
	current?: McpServerConfig,
): Omit<McpServerConfig, "id" | "createdAt" | "updatedAt"> {
	const transport = isTransport(payload.transport) ? payload.transport : current?.transport ?? "stdio";
	const name = typeof payload.name === "string" ? payload.name.trim() : current?.name ?? "";
	if (!name) {
		throw new Error("MCP server name is required.");
	}

	const enabled = typeof payload.enabled === "boolean" ? payload.enabled : current?.enabled ?? true;
	const command = payload.command !== undefined ? normalizeOptionalString(payload.command) : (current?.command ?? null);
	const args = payload.args !== undefined ? normalizeArgs(payload.args) : (current?.args ?? []);
	const env = payload.env !== undefined ? normalizeStringRecord(payload.env, "env") : (current?.env ?? {});
	const url = payload.url !== undefined ? normalizeOptionalString(payload.url) : (current?.url ?? null);
	const headers = payload.headers !== undefined ? normalizeStringRecord(payload.headers, "headers") : (current?.headers ?? {});

	validateCommand(command, transport);
	validateUrl(url, transport);

	return {
		name,
		origin: current?.origin ?? "user",
		transport,
		enabled,
		command: transport === "stdio" ? command : null,
		args: transport === "stdio" ? args : [],
		env,
		url: transport === "stdio" ? null : url,
		headers: transport === "stdio" ? {} : headers,
	};
}

function parseStoredServer(value: unknown): McpServerConfig {
	if (!isObjectRecord(value)) {
		throw new Error("Stored MCP config is invalid.");
	}

	const transport = value.transport;
	if (
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		!isTransport(transport) ||
		typeof value.enabled !== "boolean" ||
		typeof value.createdAt !== "number" ||
		typeof value.updatedAt !== "number"
	) {
		throw new Error("Stored MCP config is invalid.");
	}

	return {
		id: value.id,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		...normalizeServerPayload({
			name: value.name,
			transport,
			enabled: value.enabled,
			command: normalizeOptionalString(value.command),
			args: normalizeArgs(value.args),
			env: normalizeStringRecord(value.env, "env"),
			url: normalizeOptionalString(value.url),
			headers: normalizeStringRecord(value.headers, "headers"),
		}),
		origin: isOrigin(value.origin) ? value.origin : "user",
	};
}

export class McpStore {
	constructor(private readonly filePath: string) {}

	private async readPayload(): Promise<McpStorePayload> {
		try {
			const raw = await readFile(this.filePath, "utf8");
			const parsed: unknown = JSON.parse(raw);
			if (!isObjectRecord(parsed) || !Array.isArray(parsed.servers)) {
				throw new Error("Stored MCP config is invalid.");
			}

			return {
				servers: sortServers(parsed.servers.map(parseStoredServer)),
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
				return { servers: [] };
			}

			throw error;
		}
	}

	private async writePayload(payload: McpStorePayload) {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, `${JSON.stringify({ servers: sortServers(payload.servers) }, null, 2)}\n`, "utf8");
	}

	async list(): Promise<McpServersResponse> {
		return this.readPayload();
	}

	async create(input: CreateMcpServerRequest): Promise<McpServersResponse> {
		const payload = await this.readPayload();
		const now = Date.now();
		payload.servers.push({
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
			...normalizeServerPayload(input),
		});
		await this.writePayload(payload);
		return { servers: sortServers(payload.servers) };
	}

	async upsertBuiltIn(definition: BuiltInMcpServerDefinition): Promise<McpServersResponse> {
		const payload = await this.readPayload();
		const now = Date.now();
		const index = payload.servers.findIndex((server) => server.id === definition.id);
		if (index === -1) {
			payload.servers.push({
				...definition,
				origin: "built_in",
				createdAt: now,
				updatedAt: now,
			});
		} else {
			const current = payload.servers[index]!;
			payload.servers[index] = {
				...definition,
				origin: "built_in",
				enabled: current.enabled,
				createdAt: current.createdAt,
				updatedAt: current.updatedAt,
			};
		}

		await this.writePayload(payload);
		return { servers: sortServers(payload.servers) };
	}

	async update(id: string, input: UpdateMcpServerRequest): Promise<McpServersResponse> {
		const payload = await this.readPayload();
		const index = payload.servers.findIndex((server) => server.id === id);
		if (index === -1) {
			throw new Error("MCP server not found.");
		}

		const current = payload.servers[index]!;
		if (current.origin === "built_in" && Object.keys(input).some((key) => key !== "enabled")) {
			throw new Error("Built-in MCP servers can only be enabled or disabled.");
		}
		payload.servers[index] = {
			...current,
			...normalizeServerPayload(input, current),
			updatedAt: Date.now(),
		};
		await this.writePayload(payload);
		return { servers: sortServers(payload.servers) };
	}

	async delete(id: string): Promise<McpServersResponse> {
		const payload = await this.readPayload();
		if (payload.servers.some((server) => server.id === id && server.origin === "built_in")) {
			throw new Error("Built-in MCP servers cannot be deleted.");
		}
		const nextServers = payload.servers.filter((server) => server.id !== id);
		if (nextServers.length === payload.servers.length) {
			throw new Error("MCP server not found.");
		}

		await this.writePayload({ servers: nextServers });
		return { servers: sortServers(nextServers) };
	}
}
