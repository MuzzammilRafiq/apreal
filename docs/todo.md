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
