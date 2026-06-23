import { spawn, type ChildProcess } from "node:child_process";
import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
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
	private killTimers = new Map<ChildProcess, ReturnType<typeof setTimeout>>();

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pending) {
			pending.reject(error);
		}
		this.pending.clear();
	}

	private clearKillTimer(worker: ChildProcess): void {
		const timer = this.killTimers.get(worker);
		if (timer) {
			clearTimeout(timer);
			this.killTimers.delete(worker);
		}
	}

	private killWorker(worker: ChildProcess, signal: NodeJS.Signals): void {
		if (!worker || worker.killed) {
			return;
		}

		if (worker.pid && process.platform !== "win32") {
			try {
				process.kill(-worker.pid, signal);
				return;
			} catch {
				// Fall through to killing the direct child if process-group kill fails.
			}
		}

		worker.kill(signal);
	}

	private terminateWorker(error: Error): void {
		const worker = this.worker;
		this.rejectAllPending(error);
		this.buffer = "";
		if (!worker || worker.killed) {
			this.worker = null;
			return;
		}

		this.killWorker(worker, "SIGTERM");
		this.clearKillTimer(worker);
		const killTimer = setTimeout(() => {
			this.killWorker(worker, "SIGKILL");
		}, 5_000);
		killTimer.unref?.();
		this.killTimers.set(worker, killTimer);
		this.worker = null;
	}

	private ensureWorker(): ChildProcess {
		if (this.worker && !this.worker.killed) {
			return this.worker;
		}

		const worker = spawn("uv", ["run", "worker.py"], {
			cwd: PYTHON_SCRIPTS_DIR,
			env: process.env,
			detached: process.platform !== "win32",
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
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
			this.clearKillTimer(worker);
			if (!this.disposed && code !== 0) {
				console.error(`[web_search worker] exited with code ${code}`);
			}
			if (this.worker === worker) {
				this.rejectAllPending(new Error(`Worker exited with code ${code ?? "unknown"}`));
				this.buffer = "";
				this.worker = null;
			}
		});

		worker.on("error", (err) => {
			this.clearKillTimer(worker);
			console.error("[web_search worker] spawn error:", err.message);
			if (this.worker === worker) {
				this.rejectAllPending(new Error(`Worker spawn failed: ${err.message}`));
				this.worker = null;
			}
		});

		this.worker = worker;
		return worker;
	}

	async search(params: WebSearchParams, signal?: AbortSignal): Promise<unknown[]> {
		if (this.disposed) {
			throw new Error("SearchWorker has been disposed");
		}
		if (signal?.aborted) {
			throw new Error("Search request aborted.");
		}

		const id = this.nextId++;
		const worker = this.ensureWorker();

		return new Promise((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
			};

			const wrappedResolve = (value: unknown[]) => {
				cleanup();
				resolve(value);
			};
			const wrappedReject = (error: Error) => {
				cleanup();
				reject(error);
			};

			const abortError = () => new Error("Search request aborted.");
			const onAbort = () => {
				this.pending.delete(id);
				wrappedReject(abortError());
				this.terminateWorker(abortError());
			};

			const timeout = setTimeout(() => {
				this.pending.delete(id);
				const error = new Error("Search request timed out after 60s");
				wrappedReject(error);
				this.terminateWorker(error);
			}, 60_000);

			this.pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });
			signal?.addEventListener("abort", onAbort, { once: true });

			const request = JSON.stringify({ id, query: params.query, params });
			try {
				worker.stdin!.write(request + "\n");
			} catch (err) {
				this.pending.delete(id);
				wrappedReject(new Error(`Failed to write to worker stdin: ${err instanceof Error ? err.message : String(err)}`));
			}
		});
	}

	dispose(): void {
		this.disposed = true;
		this.terminateWorker(new Error("SearchWorker has been disposed"));
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
	async execute(_toolCallId, params: WebSearchParams, signal) {
		const results = await searchWorker.search(params, signal);

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
