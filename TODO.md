# Security TODO

- Add structured audit logging for auth and pairing events.
  Record sign-in, sign-out, pairing, token issuance and refresh, and failed authorization attempts without leaking credentials.

- Add distributed rate limits on public relay and auth endpoints.
  Cover `/api/auth/*`, relay client auth, heartbeat, and pairing endpoints with limits that work across multiple relay instances.

- Replace the local browser's cookie-plus-client-ID authentication with CSRF-resistant sessions.
  Issue an unguessable per-browser session secret and require it on every browser-facing local endpoint without breaking SSE reconnects or private-network access.

- Move durable relay browser identity out of `localStorage`.
  Choose a storage model that survives browser restarts without exposing reusable `clientId` and `clientKey` material to page JavaScript.

- Add first-class credential revocation and rotation.
  Track and revoke individual browser, client, and agent credentials without relying on a global signing-secret rotation.

- Do a final production security pass before launch.
  Re-check trusted origins, Google OAuth origins, cookie behavior, durable storage, relay authorization, filesystem locations, and secret rotation in the deployed environment.
