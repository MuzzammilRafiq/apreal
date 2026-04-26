# Relay Server Auth

The relay in `apps/relay-server` now exposes authenticated HTTP endpoints only.

The browser chat path does not currently use the relay. The active browser transport is direct `POST /api/client/message` plus `GET /api/client/stream` against `apps/server`.

## Active Endpoint

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
- `GET /health` returns relay health plus `transport: "http"`.
- `JWT_SECRET` must be set for token verification.
- Requests with missing, invalid, or mismatched target scope are rejected with `401` or `403`.
