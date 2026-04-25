# Relay Server Auth

The relay in `apps/relay-server` now uses an explicit pairing-first model.

- Browser clients connect to the relay with a short-lived client JWT.
- Agent servers connect to the relay with an agent JWT.
- First-time client-agent binding happens only after the user copies the browser pairing code into the agent server.
- After a pairing is claimed once, the relay reuses that durable binding across reconnects until it is replaced.

The browser and agent never connect directly to each other. Both keep WebSocket connections to the relay, and the relay forwards messages in both directions.

## Token Contract

- Signing algorithm: `HS256`
- Secret source: `process.env.JWT_SECRET`
- Required claims:

```json
{
  "type": "agent" | "client",
  "id": "unique-id",
  "pairingCode": "ABC12345",
  "iat": 1710000000,
  "exp": 1710086400
}
```

Notes:

- `pairingCode` is optional and used only for first-time agent claim.
- Client tokens do not need `pairingCode`.
- If an agent already has a durable pairing in relay state, reconnects can omit the pairing code.

The relay trusts only verified token payloads. It never trusts caller-provided sender IDs in forwarded messages.

## Durable Relay State

The relay keeps live socket maps in memory for low-latency forwarding, but SQLite is the durable source of truth.

- `principals`: authenticated client and agent registrations plus online or offline status.
- `pairing_requests`: pending client pairing codes waiting to be claimed by an agent.
- `pairings`: durable one-to-one `clientId <-> agentId` bindings.
- `queued_envelopes`: undelivered relay envelopes for offline peers.

By default the relay stores this database at `.data/relay-state.sqlite`. Override that path with `RELAY_SQLITE_PATH` if needed.

## Bootstrap Flow

The browser keeps a stable `clientId` in local storage, then calls `POST /api/relay/bootstrap`.

The relay bootstrap response now includes:

```json
{
  "clientId": "client-browser-01",
  "token": "<jwt>",
  "expiresAt": 1710086400000,
  "websocketUrl": "ws://localhost:3001",
  "pairing": {
    "type": "pairing_state",
    "status": "pending",
    "clientId": "client-browser-01",
    "pairingCode": "ABC12345",
    "agentId": null,
    "expiresAt": 1710000600000
  }
}
```

If the client already has a durable pairing, the response instead returns:

```json
{
  "type": "pairing_state",
  "status": "paired",
  "clientId": "client-browser-01",
  "pairingCode": null,
  "agentId": "agent-laptop-01",
  "expiresAt": null
}
```

## Pairing Claim Flow

1. Browser boots through the relay and receives a pairing code.
2. User copies that code into the agent server.
3. Agent server connects with an agent JWT that includes `pairingCode`.
4. Relay validates the code, creates the durable `clientId <-> agentId` pairing, and clears the pending request.
5. Relay sends a `pairing_state` update to the browser so normal app traffic can begin.

## Relay Message Shape

Inbound app messages are targetless. The relay resolves the real destination from the stored pairing.

Example browser command:

```json
{
  "type": "command",
  "action": "session_message",
  "payload": {
    "type": "hello"
  }
}
```

Example agent response:

```json
{
  "type": "response",
  "action": "session_message",
  "payload": {
    "type": "sessions_updated",
    "sessions": []
  }
}
```

Forwarded relay envelopes still contain resolved metadata:

```json
{
  "type": "response",
  "to": "client",
  "targetId": "client-browser-01",
  "action": "session_message",
  "payload": {
    "type": "sessions_updated",
    "sessions": []
  },
  "fromId": "agent-laptop-01",
  "fromType": "agent"
}
```

## Example Browser Relay Connection

```ts
const bootstrap = await fetch("http://localhost:3000/api/relay/bootstrap", {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({ clientId: "client-browser-01" })
}).then((response) => response.json());

const browserSocket = new WebSocket(bootstrap.websocketUrl, ["relay.jwt", bootstrap.token]);

browserSocket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "pairing_state") {
    console.log("pairing update", message);
  }
});
```

## Example Agent Token

```ts
import { generateToken } from "../apps/relay-server/src/auth.ts";

process.env.JWT_SECRET = "replace-me";

const agentToken = generateToken({
  type: "agent",
  id: "agent-laptop-01",
  pairingCode: "ABC12345"
});
```

## Runtime Notes

- Local default relay port is `3001`.
- Behind Nginx, preserve `Authorization` for Node peers and `Sec-WebSocket-Protocol` for browser peers.
- `apps/server` and `apps/relay-server` must share the same `JWT_SECRET` when the server mints relay JWTs locally.
- Invalid or missing tokens are closed with WebSocket code `1008`.
- Agent pairing failures use close reasons such as `pairing_required`, `pairing_invalid`, and `pairing_expired`.
- If a paired target is offline, the relay queues the outbound envelope and flushes it on reconnect.

## Relay Mode

Server-side env:

- `PI_RELAY_URL=wss://relay.example.com`
- `PI_RELAY_AGENT_ID=agent-laptop-01`
- `PI_RELAY_PAIRING_CODE=ABC12345` optional for first-time claim
- `PI_RELAY_AGENT_JWT=<jwt>` optional if an external issuer is used
- `JWT_SECRET=<shared-secret>`
- `RELAY_SQLITE_PATH=/absolute/path/to/relay-state.sqlite` optional on `apps/relay-server`

Web-side env:

- `VITE_PI_SERVER_URL=http://localhost:3000`
- `VITE_PI_RELAY_URL=wss://relay.example.com`

For local development and production, the browser should persist its `clientId`, fetch a short-lived client JWT at runtime, display the pairing code, and wait for the agent to claim it through the relay.
