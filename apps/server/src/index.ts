import { runWebServer } from "./web.ts";
// import dotenv from "dotenv";

// dotenv.config();
export async function main() {
	return runWebServer();
}

if (import.meta.main) {
	void main();
}