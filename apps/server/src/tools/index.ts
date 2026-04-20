import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { webSearchTool } from "./web-search.ts";

export { webSearchTool } from "./web-search.ts";

export const customTools: ToolDefinition[] = [webSearchTool];