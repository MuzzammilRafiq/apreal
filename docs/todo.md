# Security TODO

- Remove temporary trusted origins from `BETTER_AUTH_TRUSTED_ORIGINS` after the production domain is live.
  Keep only the domains that must remain usable, and remove `localhost` plus the temporary Vercel URL when they are no longer needed.

- Keep Google OAuth authorized JavaScript origins aligned with the active frontend domains.
  Remove stale origins when they are no longer used.

- Review relay CORS configuration for credentialed requests.
  Only allow trusted web origins to make authenticated browser requests to `api.malikmuzzammilrafiq.store`.

- Confirm Better Auth cookies are set with the intended production attributes.
  Re-check `Secure`, `SameSite=None`, and any domain/path behavior after the final custom domain is attached.

- Rotate `BETTER_AUTH_SECRET`, `JWT_SECRET`, and Google client secret before production launch if any were reused during setup or testing.

- Decide where relay auth SQLite data lives in production and make it durable.
  Ensure the Better Auth database is backed up and not lost on restart or redeploy.

- Add server-side authorization checks everywhere remote actions touch agent or server state.
  Signing in is not sufficient; every relay action must enforce ownership or permission checks for the target agent/server.

- Implement the remote web transport path so the hosted app uses relay-backed APIs instead of local same-origin endpoints.
  Until this is done, the hosted UI is not the final production security shape.

- Hide or remove local-only admin and configuration actions from the remote web build.
  The remote UI should not expose controls that are only safe on the laptop-local interface.

- Add audit logging for auth and pairing events.
  At minimum record sign-in, sign-out, pairing, token issuance/refresh, and failed authorization attempts.

- Define a token expiry and rotation policy for browser, client, and agent credentials.
  Document how sessions are revoked and how compromised pairings are invalidated.

- Add rate limits on auth and relay endpoints that are reachable from the public internet.
  Focus first on `/api/auth/*`, relay client auth, heartbeat, and pairing-related endpoints.

- Add a production security review pass before launch.
  Verify origin allowlists, cookie behavior, OAuth configuration, relay authorization, token storage, and secret handling end to end.

- Lock down the local web server against cross-origin localhost abuse.
  The local server currently returns permissive CORS headers and accepts caller-chosen local client IDs for browser chat/auth flows. Require strict `Origin` validation plus an unguessable local session secret or CSRF token for all browser-facing local endpoints instead of trusting loopback/private-network source address alone.

- Put the local-only authorization gate on every MCP admin route.
  `/api/admin/mcp`, `/api/admin/mcp/refresh`, and per-server PATCH/DELETE routes currently bypass `assertLocalAdminRequest`. Because MCP config can add arbitrary stdio commands and outbound URLs, this is an unauthenticated config-tampering, SSRF, and potential local RCE path if the port is reachable.

- Fix relay CORS for credentialed browser requests.
  The relay currently reflects arbitrary request origins when `RELAY_CORS_ALLOW_ORIGIN` is unset while also sending `Access-Control-Allow-Credentials: true`. Change this to an explicit allowlist for `/api/auth/*`, `/api/relay/auth/*`, and `/api/relay/connection` so third-party sites cannot use a signed-in browser session to read owner grants or mint paired client tokens.

- Remove durable relay browser credentials from `localStorage`.
  The remote web app persists `clientId` and `clientKey` in browser storage even though it no longer persists the relay bearer token there. Move durable browser credentials behind HttpOnly cookies or another safer mechanism, because any XSS or browser-extension compromise can still expose reusable relay client identity material.

- Keep relay signing separate from Better Auth signing and review token lifetimes.
  Relay transport JWTs are now short-lived and owner grants are short-lived too, but Better Auth may still fall back to `JWT_SECRET` when `BETTER_AUTH_SECRET` is unset. Use separate secrets in all environments and review whether the current relay token lifetime is appropriate for production.

- Tighten filesystem handling for stored auth material.
  `relay-auth.json`, the relay owner binding store, and the Better Auth SQLite database should be created with user-only permissions and reviewed for safe storage location, because they currently hold reusable credentials or account-linking state on disk.

- Bind the laptop-local web server to loopback by default unless LAN access is explicitly enabled.
  Today the HTTP server listens without a host restriction, which broadens the impact of any missed auth check on local admin endpoints.
