# Relay server source layout

The relay server is organized by responsibility. Dependencies should generally
flow from the entry point into the relay composition layer and then into the
smaller infrastructure modules.

```text
src/
├── index.ts                 # Node HTTP server bootstrap
├── auth/                    # Better Auth and relay token identities
├── config/                  # Environment parsing and defaults
├── observability/           # Structured logging and security audit events
├── storage/                 # Durable credential and owner-binding stores
├── relay/
│   ├── app.ts               # Express app and raw WebSocket upgrade routing
│   ├── context.ts           # Shared route operations and dependencies
│   ├── state.ts             # In-memory relay state
│   ├── connection-types.ts  # Internal connection contracts
│   ├── http/                # CORS and Node/Express response helpers
│   ├── protocol/            # Request parsing, authorization, response shapes
│   ├── routes/              # Small Express routers grouped by API concern
│   └── transport/           # SSE and WebSocket connection implementation
└── tests/                   # Unit and end-to-end relay tests
```

Route modules should coordinate a request, while reusable policy belongs in
`protocol/` and long-lived connection behavior belongs in `transport/`. Storage,
authentication, and observability stay independent of Express.
