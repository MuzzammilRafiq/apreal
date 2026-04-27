import { runWebServer } from "./web.ts";

export async function main() {
	return runWebServer();
}

if (import.meta.main) {
	void main();
}