import type { IncomingMessage, ServerResponse } from "node:http";

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

export function setHeaders(response: ServerResponse, headers: Record<string, string>) {
	for (const [key, value] of Object.entries(headers)) {
		response.setHeader(key, value);
	}
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown, headers?: Record<string, string>) {
	const body = JSON.stringify(payload);
	response.statusCode = statusCode;
	response.setHeader("content-type", "application/json");
	if (headers) {
		setHeaders(response, headers);
	}
	response.end(body);
}

export function sendText(response: ServerResponse, statusCode: number, body: string, headers?: Record<string, string>) {
	response.statusCode = statusCode;
	response.setHeader("content-type", "text/plain; charset=utf-8");
	if (headers) {
		setHeaders(response, headers);
	}
	response.end(body);
}

export function readRequestBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";

		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			resolve(body);
		});
		request.on("error", reject);
	});
}
