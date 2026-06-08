import "./env.ts";

import { runWebServer } from "./web";
import { fileURLToPath } from "node:url";
export async function main() {
	return runWebServer();
}

if (typeof process.argv[1] === "string" && fileURLToPath(import.meta.url) === process.argv[1]) {
	void main();
}
