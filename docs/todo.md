# Security TODO

- Add server-side authorization checks for remote settings and admin mutations.
  The remote UI now hides most local-only sections, but the shared message handlers still need transport-aware permission checks so a relay-authenticated client cannot invoke local-only actions directly.

- Add audit logging for auth and pairing events.
  Record sign-in, sign-out, pairing, token issuance and refresh, and failed authorization attempts.

- Add rate limits on public relay and auth endpoints.
  Start with `/api/auth/*`, relay client auth, heartbeat, and pairing-related endpoints.

- Lock down the local web server against cross-origin localhost abuse.
  Origin checks exist now, but local browser chat still trusts caller-supplied client IDs plus the local auth cookie. Add a CSRF token or another unguessable local session secret for browser-facing local endpoints.

- Remove durable relay browser credentials from `localStorage`.
  The remote web app still persists `clientId` and `clientKey` in browser storage, which leaves reusable browser identity material exposed to XSS or hostile extensions.

- Keep relay signing separate from Better Auth signing and finalize token policy.
  Better Auth can still fall back to `JWT_SECRET` when `BETTER_AUTH_SECRET` is unset. Require separate secrets in every environment and document expiry, refresh, rotation, and revocation for browser, client, and agent credentials.

- Tighten filesystem permissions for stored auth material.
  `relay-auth.json`, the relay owner binding store, and the Better Auth SQLite database should be created with user-only permissions and reviewed for safe storage location.

- Do a final production security pass before launch.
  Re-check trusted origins, Google OAuth origins, cookie behavior, durable storage, relay authorization, and secret rotation in the deployed environment.
