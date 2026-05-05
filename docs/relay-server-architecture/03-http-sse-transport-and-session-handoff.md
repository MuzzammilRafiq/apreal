# Part 3: HTTP, SSE, And Session Handoff

## 1. Why The Transport Is Split

The relay does not use a full-duplex socket protocol.

Instead it composes bidirectional messaging out of two primitives:

- SSE for server-to-client delivery
- JSON POST for client-to-server delivery

That pattern exists on both sides of the relay.

### Browser side

- downlink: `GET /api/client/stream`
- uplink: `POST /api/client/message`

### Pi server side

- downlink: `GET /api/relay/agent/stream`
- uplink: `POST /api/relay/agent/message`

So the relay is really bridging two half-duplex pairs.

## 2. Browser Stream Registration

Browser stream setup lives in `registerBrowserClientStream()` in `apps/relay-server/src/index.ts`.

The relay:

1. extracts a client token from the `Authorization` header or `token` query parameter
2. verifies that the token exists in the token store
3. verifies the token payload is for a `client`
4. verifies the client is paired to an `agent`
5. opens an SSE response
6. stores a `RelayBrowserClientConnection` in `browserClients`
7. sends a `client_connect` command to the paired agent stream

The SSE response headers are explicitly set to:

- `cache-control: no-store`
- `connection: keep-alive`
- `content-type: text/event-stream; charset=utf-8`
- `x-accel-buffering: no`

The relay then writes:

- `: connected` once at stream start
- `: ping` every 15 seconds as an SSE comment heartbeat

If another stream opens for the same `clientId`, the old one is closed and replaced.

## 3. Agent Stream Registration

Agent stream setup lives in `handleAgentStreamRequest()` in `apps/relay-server/src/index.ts`.

The relay:

1. reads the bearer token
2. requires that it exists in the token store
3. requires that the principal type is `agent`
4. opens an SSE response to the Pi server
5. stores a `RelayAgentConnection` in `agentConnections`
6. notifies the agent about all currently connected browser clients already paired to it

This last point matters: if the agent stream reconnects while browser streams are still present, the relay replays `client_connect` commands for those clients so the Pi server can rebuild its transport-side connection state.

## 4. Relay Event Shapes

The relay sends commands from relay to Pi server as `RelayAgentCommand`:

```ts
type RelayAgentCommand =
  | { type: "client_connect"; clientId: string }
  | { type: "client_disconnect"; clientId: string; reason?: string }
  | { type: "client_message"; clientId: string; message: unknown }
```

The Pi server sends messages back to the relay as `RelayAgentMessage`:

```ts
type RelayAgentMessage = {
  type: "server_message";
  clientId: string;
  message: unknown;
}
```

## 5. How SSE Is Encoded

The relay manually formats SSE frames:

- payload frame: `data: <json>\n\n`
- heartbeat comment: `: ping\n\n`

No event names, ids, or resume cursors are used.

That means the stream is intentionally simple:

- JSON data payloads only
- comments for keepalive
- no replay support
- no resumable cursor protocol

## 6. Live Message Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as Relay
    participant P as Pi Server
    participant Sess as Session / client manager

    P->>R: GET /api/relay/agent/stream (SSE)
    R-->>P: : connected / : ping comments
    B->>R: GET /api/client/stream?token=...
    R-->>B: : connected / : ping comments
    R-->>P: data: {type: client_connect, clientId}
    P->>Sess: register relay-backed client

    B->>R: POST /api/client/message
    R-->>P: data: {type: client_message, clientId, message}
    P->>Sess: handle client message
    Sess-->>P: server payload
    P->>R: POST /api/relay/agent/message\n{type: server_message, clientId, message}
    R-->>B: data: <server payload>

    B-xR: browser stream closes
    R-->>P: data: {type: client_disconnect, clientId, reason}
```

## 7. Browser To Relay To Pi Server

`handleClientMessageRequest()` in `apps/relay-server/src/index.ts` receives browser POST messages.

The relay first resolves the client target from the token. Then it verifies that the browser stream is already connected. That is a deliberate rule: posting messages is not enough, the relay expects the browser's SSE receive path to be alive too.

If that check passes, the relay forwards a `client_message` command over the agent SSE stream.

If the agent stream is unavailable, the relay returns an availability failure instead of buffering.

## 8. Pi Server To Relay To Browser

The Pi server posts browser-visible messages through `postRelayServerMessage()` in `apps/server/src/web-relay.ts`.

That function performs an authenticated `POST /api/relay/agent/message`.

The relay then:

1. verifies the agent token
2. parses the payload as `server_message`
3. finds the browser client by `clientId`
4. verifies the client belongs to that agent
5. writes the payload directly into the browser SSE stream

If the target browser stream is gone, the relay returns a conflict response.

## 9. Where Session Handling Starts

The real session handoff is on the Pi server, not inside the relay.

In `apps/server/src/web-relay.ts`:

- `handleRelayAgentCommand()` receives `client_connect`, `client_disconnect`, and `client_message`
- `ensureRelayClientConnection()` registers a relay-backed client transport in the Pi server's client manager
- `handleClientMessage()` is the point where a relay-forwarded browser message enters the normal server-side session pipeline

So the relay does not have a dedicated session handler. It hands transport events to the Pi server, and the Pi server reuses its existing local client/session machinery.

## 10. Pi Server Stream Consumer

The Pi server consumes the relay agent stream in `consumeRelayAgentStream()` in `apps/server/src/web-relay.ts`.

It uses the Fetch API stream reader directly:

1. `fetch()` the relay agent SSE endpoint
2. get `response.body.getReader()`
3. decode bytes with `TextDecoder`
4. accumulate text into a buffer
5. split SSE events on blank-line boundaries
6. collect `data:` lines
7. JSON-parse them into `RelayAgentCommand`
8. dispatch them into the local relay adapter

That is a fully manual SSE consumer on the server side.

## 11. Reconnect Behavior

The Pi server runs a reconnect loop in `runRelayTransportLoop()`.

If the agent SSE stream ends or errors:

- the relay-backed client connections are marked disconnected on the Pi server
- the Pi server waits `RELAY_STREAM_RETRY_MS`
- the Pi server reconnects using the same current agent token unless a restart or reauthentication changed generation

This is a small generation-based reconnect design rather than a full transport supervisor framework.