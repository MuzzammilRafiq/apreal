import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createCorsHeaders } from "./utils.ts";
import { getErrorMessage } from "../session.ts";

export function createNodeRequest(request: IncomingMessage, response: ServerResponse): Request {
	const protocol = request.headers["x-forwarded-proto"] ?? "http";
	const host = request.headers.host ?? "localhost";
	const url = new URL(request.url ?? "/", `${protocol}://${host}`);
	const abortController = new AbortController();
	const remoteAddress = request.socket.remoteAddress?.trim();
	const remoteFamily = request.socket.remoteFamily?.trim();

	request.once("aborted", () => abortController.abort());
	response.once("close", () => {
		if (!response.writableEnded) {
			abortController.abort();
		}
	});

	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (typeof value === "undefined") {
			continue;
		}

		if (Array.isArray(value)) {
			for (const headerValue of value) {
				headers.append(key, headerValue);
			}
			continue;
		}

		headers.set(key, value);
	}

	if (remoteAddress) {
		headers.set("x-pi-remote-address", remoteAddress);
	}

	if (remoteFamily) {
		headers.set("x-pi-remote-family", remoteFamily);
	}

	const body = request.method === "GET" || request.method === "HEAD"
		? undefined
		: (Readable.toWeb(request) as ReadableStream<Uint8Array>);
	const init: RequestInit & { duplex?: "half" } = {
		method: request.method ?? "GET",
		headers,
		signal: abortController.signal,
	};

	if (body) {
		init.body = body;
		init.duplex = "half";
	}

	return new Request(url, init);
}

export async function sendNodeResponse(response: ServerResponse, webResponse: Response) {
	response.statusCode = webResponse.status;
	response.statusMessage = webResponse.statusText;
	webResponse.headers.forEach((value, key) => {
		response.setHeader(key, value);
	});

	if (!webResponse.body) {
		response.end();
		return;
	}

	await pipeline(Readable.fromWeb(webResponse.body as ReadableStream<Uint8Array>), response);
}

export async function startHttpServer(
	port: number,
	handler: (request: Request) => Promise<Response>,
	host?: string,
): Promise<{ server: HttpServer; port: number }> {
	const server = createServer((request, response) => {
		const webRequest = createNodeRequest(request, response);
		void (async () => {
			try {
				const webResponse = await handler(webRequest);
				await sendNodeResponse(response, webResponse);
			} catch (error) {
				if (response.headersSent) {
					response.destroy(error instanceof Error ? error : undefined);
					return;
				}

				response.writeHead(500, {
					...createCorsHeaders(webRequest),
					"cache-control": "no-store",
					"content-type": "application/json; charset=utf-8",
				});
				response.end(JSON.stringify({ message: getErrorMessage(error) }));
			}
		})();
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};

		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to resolve HTTP server address.");
	}

	return {
		server,
		port: (address as AddressInfo).port,
	};
}
