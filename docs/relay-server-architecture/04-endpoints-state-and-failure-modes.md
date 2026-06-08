# Part 4: Endpoints, State, And Failure Modes

## 1. Endpoint Table

| Path | Method | Purpose |
| --- | --- | --- |
| `/` | `GET` | health alias |
| `/health` | `GET` | health payload including auth and owner binding metadata |
| `/api/auth/*` | various | Better Auth endpoints hosted by the relay |
| `/api/relay/auth/client` | `POST` | issue or refresh browser relay auth |
| `/api/relay/heartbeat` | `POST` | return browser relay auth plus readiness flags |
| `/api/relay/auth/agent/owner-grant` | `POST` | issue a short-lived owner grant for laptop linking |
| `/api/relay/auth/agent` | `POST` | issue or refresh laptop agent auth |
| `/api/relay/agent/stream` | `GET` | relay-to-agent SSE command stream |
| `/api/relay/agent/message` | `POST` | agent-to-relay upstream message path |
| `/api/client/stream` | `GET` | relay-to-browser SSE message stream |
| `/api/client/message` | `POST` | browser-to-relay upstream message path |
| `/api/relay/connection` | `POST` | relay-side authorization check for a requested target |

The active endpoint routing is implemented in `apps/relay-server/src/relay/routes.ts`.

## 2. Readiness Semantics

The client heartbeat response returns two important booleans:

- `serverReady`
- `transportReady`

These are not the same thing.

### `serverReady`

The relay reports `serverReady = true` when there is a non-expired in-memory agent auth session for the targeted `agentId` in `agentSessions`.

This means the laptop agent authenticated recently enough for the relay to consider it available in principle.

### `transportReady`

The relay reports `transportReady = true` only when there is also a live in-memory `agentConnections` entry for that target and it is not closed.

This means the laptop server's outbound SSE stream is currently connected.

### Current settings authorization payload

`buildClientHeartbeatResponse()` currently returns:

- `settingsAuthorization.sections = ["account"]`

So readiness and remote settings access are related but separate parts of the heartbeat response.

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
2. sends `client_disconnect` to the targeted agent
3. ends the HTTP response if needed

### When an agent stream closes

The relay:

1. removes that agent from `agentConnections`
2. closes every browser client targeted to that agent
3. ends the agent HTTP response if needed

So an agent transport failure cascades to all currently attached browser streams for that agent.

## 5. Error Classes In Practice

The relay mostly uses a dedicated `AuthError` for controlled protocol failures.

Typical outcomes:

- `401`: missing token, invalid token, malformed authorization, expired token
- `403`: wrong peer type, token target mismatch, unpaired client token, wrong target direction
- `409`: target browser stream is absent during agent message delivery
- `503`: paired agent transport unavailable or browser stream missing for a client post

Status mapping is centralized in helper functions like:

- `mapRelayProxyErrorStatus()`
- `mapRelayConnectionErrorStatus()`

## 6. State Persistence And Limits

Durable state:

- owner-to-agent bindings in a JSON file

Non-durable state:

- browser live connections
- agent live connections
- in-memory `agentSessions`
- in-flight message delivery

Not supported by the relay today:

- queued offline delivery
- resumable streams
- event ids or replay cursors
- multi-node shared connection state
- distributed session replication
- durable message history

## 7. Leftovers From The Older Architecture

Some `serverUrl` handling still exists in relay token types and validation code.

Examples include:

- optional `serverUrl` fields in auth payloads
- `validateAgentServerUrl()` in `apps/relay-server/src/relay/authorization.ts`

But the active transport path no longer forwards browser traffic by calling a callback URL. The live system now relies on the outbound agent SSE stream plus the relay's in-memory connection maps.

That means `serverUrl` is best understood as compatibility leftover state, not the primary transport path.

## 8. Production Concerns

The current design is intentionally simple, but the main hardening gaps are clear.

### Query-string token use for browser SSE

The relay allows client stream auth through `?token=` because browser `EventSource` cannot set arbitrary auth headers.

That is practical, but query strings are easier to leak into logs and proxies.

### In-memory transport state

A relay restart drops all live connections immediately. Recovery depends on both sides reconnecting.

### Single-node assumption

Because transport maps live in process memory, the current relay design assumes one active relay instance for a given live connection set.

### Broad public auth surface

The relay is the public Better Auth surface, so cookie policy, origin policy, and deployment configuration matter a lot more here than on the private laptop server.

## 9. Mental Model To Keep

The best short description of the current relay is:

> A public HTTP plus SSE broker that authenticates browser users and laptop agents, links them through shared owner identity, and forwards transport events while leaving the real application runtime on the user's laptop.
