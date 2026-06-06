# Part 2: Auth And Owner Binding

## 1. Shared Contract

The public relay routes and relay protocol types are defined in `apps/shared/src/index.ts`.

The most important pieces are:

- `RELAY_CLIENT_AUTH_PATH`
- `RELAY_CLIENT_HEARTBEAT_PATH`
- `RELAY_AGENT_AUTH_PATH`
- `RELAY_AGENT_STREAM_PATH`
- `RELAY_AGENT_MESSAGE_PATH`
- `RELAY_CONNECTION_PATH`
- `RelayAgentCommand`
- `RelayAgentMessage`

That shared package keeps the browser, relay, and Pi server on one explicit protocol.

## 2. JWT Model

JWT generation and verification live in `apps/relay-server/src/auth.ts`.

The relay accepts only two principal types:

- `client`
- `agent`

The validated payload shape is:

```ts
type AuthTokenPayload = {
  type: "client" | "agent";
  id: string;
  key: string;
  targetId?: string;
  targetType?: "client" | "agent";
  ownerUserId?: string;
  serverUrl?: string;
  iat: number;
  exp: number;
}
```

Important details:

- `id` is the stable principal identity.
- `key` is the stable credential used to reissue tokens for that same principal.
- `targetId` and `targetType` scope the token to a specific peer.
- `ownerUserId` binds the principal to the Better Auth account that owns it.
- `iat` and `exp` are required and validated.

The relay uses HS256 and currently issues long-lived tokens with a 180 day TTL.

## 3. Token Store Design

`apps/relay-server/src/token-store.ts` stores issued tokens as raw JWT strings in a JSON file.

Default path behavior:

- `RELAY_TOKEN_STORE_PATH` if configured
- otherwise a path derived from the legacy sqlite setting if present
- otherwise `.data/relay-issued-tokens.json` in the current working directory

The store does not persist expanded state objects. It persists token strings and reparses them on read.

That gives the store a simple model:

- load token strings
- verify and parse them when needed
- ignore malformed or expired tokens unless explicitly allowed
- sort valid entries by newest `iat`

## 4. Client Authentication Flow

The browser client calls `POST /api/relay/auth/client` with:

```json
{
  "clientId": "client-...",
  "clientKey": "key-...",
  "ownerGrant": "signed-owner-grant"
}
```

The relay then:

1. looks for the newest token for that `clientId` and `clientKey`
2. refreshes it if it is near expiry
3. otherwise issues a new token if none exists
4. resolves the owner from the Better Auth session or the supplied owner grant
5. if an active agent token exists for that owner, reissues the client token targeted to that agent
6. returns token, expiry, targeting state, and target data

The browser identity is durable on the client side. The web app stores `clientId` and `clientKey` in local storage in `apps/web/src/relay-auth.ts`.

## 5. Agent Authentication Flow

The Pi server calls `POST /api/relay/auth/agent` with:

```json
{
  "agentId": "agent-...",
  "agentKey": "key-...",
  "ownerGrant": "signed-owner-grant"
}
```

The relay then:

1. validates the short-lived owner grant issued by the relay to a signed-in browser
2. issues or refreshes the agent token with `ownerUserId` set to that Better Auth user
3. preserves any existing `serverUrl`
4. returns the agent token for the local server to use when opening the relay SSE transport

## 6. Owner-Binding Lifecycle Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant R as Relay
    participant S as Token Store
    participant A as Agent Server

    C->>R: POST /api/relay/auth/client\n{clientId, clientKey, ownerGrant}
    R->>S: findLatestByPrincipal(client)
    R->>S: findLatestAgentByOwnerUserId()
    alt owner has active agent
        R->>S: issueToken(client, targetId=agentId, ownerUserId)
    else no active agent yet
        R->>S: issueToken(client, ownerUserId)
    end
    R-->>C: client token

    A->>R: POST /api/relay/auth/agent\n{agentId, agentKey, ownerGrant}
    R->>S: issueToken(agent, ownerUserId)
    R-->>A: agent token bound to owner
```

## 7. Connection Authorization Check

The endpoint `POST /api/relay/connection` is a lightweight authorization verifier.

The Pi server uses it through `verifyRelayClientAccess()` in `apps/server/src/relay-auth.ts`.

The flow is:

1. a browser request arrives at the Pi server
2. the Pi server extracts the relay client token
3. the Pi server asks the relay whether this token is allowed to target this exact `agentId`
4. the relay validates peer type and target scope
5. the Pi server accepts the browser as authenticated only if the relay confirms the binding

This keeps the Pi server from trusting browser relay tokens locally without relay-side scope verification.

## 8. Important Constraint

A token is not enough by itself. The relay requires the token to also be present in its token store.

That means the relay treats stored issuance as part of validity, not just signature correctness.
