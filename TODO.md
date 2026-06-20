# Security TODO

- Do a final production security pass before launch.
  Re-check trusted origins, Google OAuth origins, cookie behavior, durable storage, relay authorization, filesystem locations, and secret rotation in the deployed environment.

# Engineering TODO

- Make `@apreal/shared` the single runtime-validated source of truth for the browser/server wire protocol.
  Move the duplicated `ClientMessage`/`ClientAppMessage`, `ServerPayload`, session, and transcript contracts into shared schemas; derive TypeScript types from them; validate messages at every HTTP, SSE, WebSocket, and relay boundary; and add contract tests that exercise valid, malformed, and version-skewed messages across both local and remote transports.
