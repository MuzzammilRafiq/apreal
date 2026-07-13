import assert from "node:assert/strict";
import test from "node:test";
import { selectBrowserOAuthMethod } from "../auth/provider-login.ts";

test("web provider login selects Pi's browser OAuth method", () => {
	assert.equal(selectBrowserOAuthMethod("openai-codex", {
		message: "Select OpenAI Codex login method:",
		options: [
			{ id: "browser", label: "Browser login (default)" },
			{ id: "device_code", label: "Device code login (headless)" },
		],
	}), "browser");
});

test("web provider login rejects selectors without a browser method", () => {
	assert.throws(() => selectBrowserOAuthMethod("example", {
		message: "Select login method:",
		options: [{ id: "device_code", label: "Device code" }],
	}), /Web login currently supports browser-based Pi OAuth only/);
});
