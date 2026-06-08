# Documentation

This directory contains architecture and implementation notes for the Apreal monorepo.

## Architecture Guides

### App architecture

These documents explain how the three main runtime pieces fit together:

- the browser client in `apps/web`
- the laptop server in `apps/server`
- the public relay in `apps/relay-server`

Read in order:

1. [`app-architecture/README.md`](./app-architecture/README.md)
2. [`app-architecture/01-system-overview.md`](./app-architecture/01-system-overview.md)
3. [`app-architecture/02-auth-linking-and-runtime-modes.md`](./app-architecture/02-auth-linking-and-runtime-modes.md)
4. [`app-architecture/03-end-to-end-flows.md`](./app-architecture/03-end-to-end-flows.md)

### Relay server architecture

These documents focus specifically on the relay implementation and protocol.

Read in order:

1. [`relay-server-architecture/README.md`](./relay-server-architecture/README.md)
2. [`relay-server-architecture/01-topology-and-runtime-model.md`](./relay-server-architecture/01-topology-and-runtime-model.md)
3. [`relay-server-architecture/02-auth-and-pairing.md`](./relay-server-architecture/02-auth-and-pairing.md)
4. [`relay-server-architecture/03-http-sse-transport-and-session-handoff.md`](./relay-server-architecture/03-http-sse-transport-and-session-handoff.md)
5. [`relay-server-architecture/04-endpoints-state-and-failure-modes.md`](./relay-server-architecture/04-endpoints-state-and-failure-modes.md)

## Other docs

- [`pi-sdk.md`](./pi-sdk.md)
- [`todo.md`](./todo.md)
