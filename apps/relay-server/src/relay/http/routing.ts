import type { Router } from "express";

import { sendText } from "./response.ts";

// Keeps the relay's previous 405 behavior after Express performs method routing.
export function registerMethodNotAllowed(router: Router, path: string) {
	router.options(path, (_request, response) => {
		response.status(204).end();
	});
	router.all(path, (_request, response) => {
		sendText(response, 405, "Method Not Allowed");
	});
}
