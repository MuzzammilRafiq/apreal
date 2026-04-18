import { runWebServer } from "./web.ts";

export function main() {
	return runWebServer();
}

if (import.meta.main) {
	main();
}