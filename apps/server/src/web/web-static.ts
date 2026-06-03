import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { ADMIN_STATUS_PATH } from "@apreal/shared";
import { SERVER_SRC_DIR } from "./utils.ts";

export const WEB_DIST_DIR = resolve(SERVER_SRC_DIR, "..", "..", "..", "web", "dist");
export const WEB_INDEX_PATH = join(WEB_DIST_DIR, "index.html");
const CONTENT_TYPES = new Map<string, string>([
	[".css", "text/css; charset=utf-8"],
	[".html", "text/html; charset=utf-8"],
	[".ico", "image/x-icon"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".map", "application/json; charset=utf-8"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".svg", "image/svg+xml"],
	[".webp", "image/webp"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
]);

function getContentType(filePath: string): string {
	return CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

export function createMissingWebUiResponse(request: Request, port: number): Response {
	const headers = new Headers({
		"cache-control": "no-store",
		"content-type": "text/html; charset=utf-8",
	});
	if (request.method === "HEAD") {
		return new Response(null, { headers });
	}

	const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Apreal server is running</title>
</head>
<body>
  <h1>Apreal server is running</h1>
  <p>The browser UI bundle is not available at this origin yet.</p>
  <p>Run <code>pnpm dev</code> for hot reload at <a href="http://localhost:5173">http://localhost:5173</a>, or build <code>apps/web</code> to serve it from this server.</p>
  <p><a href="/health">Health check</a></p>
  <p><a href="${ADMIN_STATUS_PATH}">Server status</a></p>
  <p>Expected build output: <code>${WEB_DIST_DIR}</code></p>
  <p>Current server: <code>http://localhost:${port}</code></p>
</body>
</html>`;

	return new Response(body, { headers });
}

export async function createStaticResponse(request: Request, url: URL): Promise<Response | null> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return null;
	}

	const requestedPath = decodeURIComponent(url.pathname);
	const normalizedRelativePath = requestedPath === "/"
		? "index.html"
		: requestedPath.replace(/^\/+/, "");
	const requestedFilePath = resolve(WEB_DIST_DIR, normalizedRelativePath);
	const allowedPrefix = `${WEB_DIST_DIR}${sep}`;
	if (requestedFilePath !== WEB_DIST_DIR && !requestedFilePath.startsWith(allowedPrefix)) {
		return new Response("Not Found", { status: 404 });
	}

	const tryServeFile = async (filePath: string): Promise<Response | null> => {
		try {
			const fileStats = await stat(filePath);
			if (!fileStats.isFile()) {
				return null;
			}

			const headers = new Headers({
				"cache-control": filePath === WEB_INDEX_PATH ? "no-store" : "public, max-age=31536000, immutable",
				"content-type": getContentType(filePath),
			});
			if (request.method === "HEAD") {
				return new Response(null, { headers });
			}

			const body = await readFile(filePath);
			return new Response(body, { headers });
		} catch {
			return null;
		}
	};

	const directMatch = await tryServeFile(requestedFilePath);
	if (directMatch) {
		return directMatch;
	}

	if (requestedPath === "/") {
		return null;
	}

	if (extname(normalizedRelativePath)) {
		return new Response("Not Found", { status: 404 });
	}

	return tryServeFile(WEB_INDEX_PATH);
}
