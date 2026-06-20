# Security TODO

- Add distributed rate limits on public relay and auth endpoints.
  Cover `/api/auth/*`, relay client auth, heartbeat, and pairing endpoints with limits that work across multiple relay instances.

- Move durable relay browser identity out of `localStorage`.
  Choose a storage model that survives browser restarts without exposing reusable `clientId` and `clientKey` material to page JavaScript.

- Add first-class credential revocation and rotation.
  Track and revoke individual browser, client, and agent credentials without relying on a global signing-secret rotation.

- Do a final production security pass before launch.
  Re-check trusted origins, Google OAuth origins, cookie behavior, durable storage, relay authorization, filesystem locations, and secret rotation in the deployed environment.
