export function createSseChunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

export function createSseComment(comment: string): string {
	return `: ${comment}\n\n`;
}

export function createSseHeaders(corsHeaders: Record<string, string>): Record<string, string> {
	return {
		...corsHeaders,
		"cache-control": "no-store",
		connection: "keep-alive",
		"content-type": "text/event-stream; charset=utf-8",
		"x-accel-buffering": "no",
	};
}
