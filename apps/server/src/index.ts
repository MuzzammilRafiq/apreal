import { runWebServer } from "./web.ts";
import { fileURLToPath } from "node:url";
// import dotenv from "dotenv";

// dotenv.config();
export async function main() {
	return runWebServer();
}

if (typeof process.argv[1] === "string" && fileURLToPath(import.meta.url) === process.argv[1]) {
	void main();
}