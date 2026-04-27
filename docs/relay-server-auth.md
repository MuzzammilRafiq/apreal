# Relay Server Auth

The relay in `apps/relay-server` exposes authenticated HTTP endpoints for auth, authorization, and browser chat proxying.

The browser chat path now goes through the relay. After an agent authenticates, it registers its reachable `PI_SERVER_URL` with the relay, and the relay proxies paired browser traffic to that server.

## Health Endpoints

`GET /`

`GET /health`

Both endpoints return a structured relay status payload so the relay base URL is directly useful as a health check.

Example response:

```json
{
  "ok": true,
  "service": "relay-server",
  "transport": "http",
  "timestamp": "2026-04-26T17:30:00.000Z",
  "auth": {
    "jwtSecretConfigured": true,
    "corsAllowOrigin": "*"
  },
  "endpoints": {
    "base": "/",
    "health": "/health",
    "clientStream": "/api/client/stream",
    "clientMessage": "/api/client/message",
    "clientAuth": "/api/relay/auth/client",
    "agentAuth": "/api/relay/auth/agent",
    "connection": "/api/relay/connection"
  }
}
```

## Browser Proxy Endpoints

`GET /api/client/stream`

`POST /api/client/message`

These browser-facing endpoints live on the relay host. The relay validates the client token, resolves the paired `agentId`, loads the registered server URL from the paired agent token, and forwards the request to the target server.

## Authorization Endpoint

`POST /api/relay/connection`

This endpoint authorizes one relay principal to talk to a specific target principal.

Request body:

```json
{
  "targetId": "agent-laptop-01",
  "targetType": "agent"
}
```

Request header:

```text
Authorization: Bearer <jwt>
```

Success response:

```json
{
  "principal": {
    "id": "client-browser-01",
    "type": "client",
    "expiresAt": 1710086400000,
    "scopedToTarget": true
  },
  "target": {
    "id": "agent-laptop-01",
    "type": "agent"
  }
}
```

## Token Contract

- Signing algorithm: `HS256`
- Secret source: `process.env.JWT_SECRET`
- Required claims:

```json
{
  "type": "agent" | "client",
  "id": "unique-id",
  "iat": 1710000000,
  "exp": 1710086400
}
```

Optional scope claims:

```json
{
  "targetId": "agent-laptop-01",
  "targetType": "agent"
}
```

Optional registered route claim for paired agent tokens:

```json
{
  "serverUrl": "https://server.example.com"
}
```

Optional pairing claim for local token generation:

```json
{
  "pairingCode": "ABC12345"
}
```

The relay trusts only verified token payloads. It does not accept caller-supplied principal identity outside the signed token.

## Example Token Generation

```ts
import { generateToken } from "../apps/relay-server/src/auth.ts";

process.env.JWT_SECRET = "replace-me";

const clientToken = generateToken({
  type: "client",
  id: "client-browser-01",
  targetId: "agent-laptop-01",
  targetType: "agent"
});
```

## Runtime Notes

- Local default relay port is `3001`.
- `GET /` and `GET /health` both return relay health plus endpoint and auth-configuration summary.
- `PI_SERVER_URL` must be set on `apps/server` so the relay can proxy browser traffic to the paired server.
- `JWT_SECRET` must be set for token verification.
- Requests with missing, invalid, or mismatched target scope are rejected with `401` or `403`.
