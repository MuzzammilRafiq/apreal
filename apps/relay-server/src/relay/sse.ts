// Serializes one SSE data frame for a JSON payload.
export function createSseChunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

// Serializes a comment-only SSE frame, used for heartbeats and connection
// markers.
export function createSseComment(comment: string): string {
	return `: ${comment}\n\n`;
}

// Returns the common response headers required for SSE transport.
export function createSseHeaders(corsHeaders: Record<string, string>): Record<string, string> {
	return {
		...corsHeaders,
		"cache-control": "no-store",
		connection: "keep-alive",
		"content-type": "text/event-stream; charset=utf-8",
		"x-accel-buffering": "no",
	};
}
