This is a monorepo

- relay server => apps/relay-server (middleman between hosted web client and agent server)
- server => apps/server (runs on the user's laptop)
- web => apps/web (browser frontend for the local server UI and hosted remote UI)
- shared => apps/shared (shared types and constants)


So short version: a local-first agent desktop system with a web frontend, a laptop-side server, and a relay for remote/authenticated access.