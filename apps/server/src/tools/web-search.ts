import { spawn, type ChildProcess } from "node:child_process";
import { Type, type Static } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PYTHON_SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/python");

interface SearchResponse {
	id: number;
	ok: boolean;
	results?: unknown[];
	error?: string;
}

const webSearchParameters = Type.Object({
	query: Type.String({ description: "Search query to run." }),
});

type WebSearchParams = Static<typeof webSearchParameters>;

class SearchWorker {
	private worker: ChildProcess | null = null;
	private pending = new Map<number, { resolve: (value: unknown[]) => void; reject: (error: Error) => void }>();
	private nextId = 0;
	private buffer = "";
	private disposed = false;

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pending) {
			pending.reject(error);
		}
		this.pending.clear();
	}

	private ensureWorker(): ChildProcess {
		if (this.worker && !this.worker.killed) {
			return this.worker;
		}

		const worker = spawn("uv", ["run", "worker.py"], {
			cwd: PYTHON_SCRIPTS_DIR,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		worker.stdout!.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString();
			let newlineIndex: number;
			while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
				const line = this.buffer.slice(0, newlineIndex).trim();
				this.buffer = this.buffer.slice(newlineIndex + 1);
				if (!line) continue;
				try {
					const response: SearchResponse = JSON.parse(line);
					const pending = this.pending.get(response.id);
					if (!pending) continue;
					this.pending.delete(response.id);
					if (response.ok && response.results) {
						pending.resolve(response.results);
					} else {
						pending.reject(new Error(response.error ?? "unknown worker error"));
					}
				} catch {
					// ignore malformed JSON lines
				}
			}
		});

		worker.stderr!.on("data", (chunk: Buffer) => {
			console.error("[web_search worker stderr]", chunk.toString());
		});

		worker.on("exit", (code) => {
			if (!this.disposed && code !== 0) {
				console.error(`[web_search worker] exited with code ${code}`);
			}
			this.rejectAllPending(new Error(`Worker exited with code ${code ?? "unknown"}`));
			this.buffer = "";
			this.worker = null;
		});

		worker.on("error", (err) => {
			console.error("[web_search worker] spawn error:", err.message);
			this.rejectAllPending(new Error(`Worker spawn failed: ${err.message}`));
			this.worker = null;
		});

		this.worker = worker;
		return worker;
	}

	async search(params: WebSearchParams): Promise<unknown[]> {
		if (this.disposed) {
			throw new Error("SearchWorker has been disposed");
		}

		const id = this.nextId++;
		const worker = this.ensureWorker();

		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });

			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("Search request timed out after 60s"));
			}, 60_000);

			const originalResolve = resolve;
			const originalReject = reject;

			const wrappedResolve = (value: unknown[]) => {
				clearTimeout(timeout);
				originalResolve(value);
			};
			const wrappedReject = (error: Error) => {
				clearTimeout(timeout);
				originalReject(error);
			};

			this.pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });

			const request = JSON.stringify({ id, query: params.query, params });
			try {
				worker.stdin!.write(request + "\n");
			} catch (err) {
				clearTimeout(timeout);
				this.pending.delete(id);
				reject(new Error(`Failed to write to worker stdin: ${err instanceof Error ? err.message : String(err)}`));
			}
		});
	}

	dispose(): void {
		this.disposed = true;
		if (this.worker && !this.worker.killed) {
			this.worker.kill("SIGTERM");
		}
		this.rejectAllPending(new Error("SearchWorker has been disposed"));
		this.worker = null;
	}
}

const searchWorker = new SearchWorker();

export const webSearchTool = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Searches the public web and returns extracted page text. Uses JavaScript rendering for sites that need it. Use this when the answer depends on current external information.",
	parameters: webSearchParameters as any,
	async execute(_toolCallId, params: WebSearchParams) {
		const results = await searchWorker.search(params);

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							query: params.query,
							results,
						},
						null,
						2,
					),
				},
			],
			details: {
				query: params.query,
				resultCount: results.length,
			},
		};
	},
});

// The worker exits when the parent Node process exits (OS cleans up child processes).
