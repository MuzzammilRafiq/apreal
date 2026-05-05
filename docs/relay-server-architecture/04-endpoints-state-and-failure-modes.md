# Part 4: Endpoints, State, And Failure Modes

## 1. Endpoint Table

| Path | Method | Purpose |
| --- | --- | --- |
| `/` | `GET` | health alias |
| `/health` | `GET` | health payload including token store metadata |
| `/api/relay/auth/client` | `POST` | issue or refresh client auth |
| `/api/relay/heartbeat` | `POST` | return client auth plus readiness flags |
| `/api/relay/auth/agent` | `POST` | issue or refresh agent auth and pairing |
| `/api/relay/agent/stream` | `GET` | relay-to-agent SSE command stream |
| `/api/relay/agent/message` | `POST` | agent-to-relay upstream message path |
| `/api/client/stream` | `GET` | relay-to-browser SSE message stream |
| `/api/client/message` | `POST` | browser-to-relay upstream message path |
| `/api/relay/connection` | `POST` | relay-side authorization check for a requested target |

Every active endpoint is implemented in `apps/relay-server/src/index.ts`.

## 2. Readiness Semantics

The client heartbeat response returns two important booleans:

- `serverReady`
- `transportReady`

These are not the same thing.

### `serverReady`

The relay reports `serverReady = true` when there is an active, non-expired agent token for the paired target in the token store.

This means the agent has authenticated successfully at least recently.

### `transportReady`

The relay reports `transportReady = true` only when there is also a live in-memory `agentConnections` entry for that target and it is not closed.

This means the Pi server's outbound SSE stream is currently connected.

That distinction is important for debugging:

- `serverReady = true`, `transportReady = false` means pairing and auth exist, but the live agent transport is down.
- both false means the relay does not currently know a live or active paired agent.

## 3. Replacement Rules

The relay does not multiplex multiple live transports for the same principal.

Instead:

- a second browser stream for the same `clientId` replaces the first
- a second agent stream for the same `agentId` replaces the first

This keeps state simple and makes one principal map to one active transport endpoint.

## 4. Failure Propagation Rules

The relay applies clear teardown rules.

### When a browser stream closes

The relay:

1. removes that browser client from `browserClients`
2. sends `client_disconnect` to the paired agent
3. ends the HTTP response if needed

### When an agent stream closes

The relay:

1. removes that agent from `agentConnections`
2. closes every browser client paired to that agent
3. ends the agent HTTP response if needed

So an agent transport failure cascades to all currently attached browser streams for that agent.

## 5. Error Classes In Practice

The relay mostly uses a dedicated `AuthError` for controlled protocol failures.

Typical outcomes:

- `401`: missing token, invalid token, unknown token
- `403`: wrong peer type, token target mismatch, wrong target direction
- `409`: target browser stream is absent during agent message delivery
- `503`: paired agent transport unavailable or browser stream missing for a client post

The exact status mapping is split between helper functions like:

- `mapRelayProxyErrorStatus()`
- `mapRelayConnectionErrorStatus()`

## 6. State Persistence And Limits

Durable state:

- issued relay tokens in a JSON file

Non-durable state:

- browser live connections
- agent live connections
- in-flight message delivery

Not supported by the relay today:

- queued offline delivery
- resumable streams
- event ids or replay cursors
- multi-node shared connection state
- distributed session replication
- durable pairing workflows beyond token persistence

## 7. Leftovers From The Older Architecture

Some `serverUrl` handling still exists in the relay token model and parsing code.

Examples include:

- optional `serverUrl` fields in auth payloads
- `findAgentServerUrl()` in the token store
- `validateAgentServerUrl()` in the relay entrypoint

But the active transport path no longer forwards browser traffic by calling a callback URL. The live system now relies on the outbound agent SSE stream plus the relay's in-memory connection maps.

That means `serverUrl` is best understood as historical leftover compatibility state, not the primary runtime transport path.

## 8. Production Concerns

The current design is intentionally simple, but the main hardening gaps are clear.

### Query-string token use for browser SSE

The relay allows client stream auth through `?token=` because browser EventSource cannot set arbitrary auth headers.

That is practical, but risky because query strings leak into logs and proxies more easily.

### Long-lived JWTs

A 180 day TTL is convenient for development and pairing stability, but it increases the blast radius of token theft.

### Broad CORS

The relay defaults to permissive CORS behavior suitable for development, not tightly scoped production deployment.

### In-memory transport state

A relay restart drops all live connections immediately. Recovery depends entirely on both sides reconnecting.

## 9. Mental Model To Keep

The best short description of the current relay is:

> A public HTTP plus SSE broker that authenticates and pairs browser clients with private Pi servers, then forwards transport events while leaving real session execution on the Pi server.