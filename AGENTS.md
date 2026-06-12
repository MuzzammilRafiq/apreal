This is a monorepo

- relay server => apps/relay-server (middleman between hosted web client and agent server)
- server => apps/server (runs on the user's laptop)
- web => apps/web (browser frontend for the local server UI and hosted remote UI)

## Current Progress

- Monorepo foundation is in place with `apps/web`, `apps/server`, `apps/relay-server`, and `apps/shared`.
- Local chat is working with persisted sessions, provider/model settings, MCP server management, system prompt append support, and scheduled jobs.
- Remote account sign-in, automatic owner pairing, singleton agent/client takeover, and hosted chat transport are implemented, but production hardening for the remote surface is still in progress.
- Update this section after every major project change; skip minor changes.
