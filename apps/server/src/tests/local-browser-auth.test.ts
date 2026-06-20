import assert from "node:assert/strict";
import test from "node:test";
import {
	LOCAL_AUTH_SESSION_HEADER,
	LOCAL_AUTH_SESSION_QUERY_PARAM,
} from "@apreal/shared";
import {
	createLocalBrowserAuthSession,
	hasLocalBrowserAuthSession,
} from "../web/local-browser-auth.ts";

function readCookiePair(setCookieHeader: string): string {
	return setCookieHeader.split(";", 1)[0] ?? "";
}

test("local browser auth requires both the signed cookie and matching browser secret", () => {
	const session = createLocalBrowserAuthSession();
	const cookie = readCookiePair(session.cookieHeader);

	assert.equal(hasLocalBrowserAuthSession(new Request("http://localhost/api", {
		headers: { cookie },
	})), false);
	assert.equal(hasLocalBrowserAuthSession(new Request("http://localhost/api", {
		headers: {
			cookie,
			[LOCAL_AUTH_SESSION_HEADER]: "wrong-secret",
		},
	})), false);
	assert.equal(hasLocalBrowserAuthSession(new Request("http://localhost/api", {
		headers: {
			cookie,
			[LOCAL_AUTH_SESSION_HEADER]: session.sessionSecret,
		},
	})), true);
});

test("local browser auth accepts query secrets only when explicitly enabled for SSE", () => {
	const session = createLocalBrowserAuthSession();
	const cookie = readCookiePair(session.cookieHeader);
	const url = new URL("http://localhost/api/client/stream");
	url.searchParams.set(LOCAL_AUTH_SESSION_QUERY_PARAM, session.sessionSecret);
	const request = new Request(url, { headers: { cookie } });

	assert.equal(hasLocalBrowserAuthSession(request), false);
	assert.equal(hasLocalBrowserAuthSession(request, { allowQuery: true }), true);
});

test("a browser secret cannot be reused with another session cookie", () => {
	const firstSession = createLocalBrowserAuthSession();
	const secondSession = createLocalBrowserAuthSession();
	const request = new Request("http://localhost/api", {
		headers: {
			cookie: readCookiePair(secondSession.cookieHeader),
			[LOCAL_AUTH_SESSION_HEADER]: firstSession.sessionSecret,
		},
	});

	assert.equal(hasLocalBrowserAuthSession(request), false);
});
