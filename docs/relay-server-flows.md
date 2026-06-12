# Relay Server Flows

This document maps the actual flow inside `apps/relay-server` so the code in
`src/` is easier to trace.

## 1. High-level architecture

```mermaid
flowchart LR
    Browser["Hosted web client<br/>apps/web"] -->|POST /api/relay/client/auth<br/>GET /api/client/stream<br/>POST /api/client/message| Relay["apps/relay-server"]
    Agent["Laptop agent/server side relay client<br/>apps/server"] -->|POST /api/relay/agent/auth<br/>GET /api/relay/agent/stream<br/>POST /api/relay/agent/message| Relay
    Owner["Signed-in owner"] -->|Better Auth session cookies| Relay
    Relay -->|/api/auth/*| BetterAuth["Better Auth runtime"]
    BetterAuth --> AuthDb["better-auth.sqlite"]
    Relay --> BindingStore["relay-owner-bindings.json"]
    Relay --> BrowserState["In-memory browserClients map"]
    Relay --> AgentState["In-memory agentConnections map"]
    Relay --> SessionState["In-memory agentSessions map"]
```

## 2. Relay bootstrap

```mermaid
flowchart TD
    Start["runRelayServer()"] --> State["createRelayServerState()"]
    State --> Binding["new RelayOwnerBindingStore()"]
    Start --> Env["getRelayEnv().PORT"]
    Start --> Router["createRelayRequestHandler(state)"]
    Router --> Server["createServer(handler)"]
    Server --> Listen["server.listen(port)"]
    Listen --> Log["log relay server listening"]
```

## 3. Better Auth request flow

```mermaid
sequenceDiagram
    participant Browser
    participant Relay as relay/routes.ts
    participant Auth as better-auth.ts
    participant BA as Better Auth
    participant DB as better-auth.sqlite

    Browser->>Relay: /api/auth/*
    Relay->>Auth: ensureBetterAuthReady()
    Auth->>Auth: isBetterAuthConfigured()
    Auth->>BA: createAuthOptions()
    BA->>DB: run migrations if needed
    Relay->>Auth: getBetterAuthHandler()
    Auth->>BA: toNodeHandler(getBetterAuth())
    BA-->>Browser: auth response / redirect / session payload
```

## 4. Owner grant and agent binding flow

```mermaid
sequenceDiagram
    participant Owner as Signed-in owner
    participant Relay
    participant Auth as Better Auth session
    participant Store as RelayOwnerBindingStore
    participant Agent

    Owner->>Relay: POST /api/relay/agent/owner-grant
    Relay->>Auth: readBetterAuthUserId(request)
    Auth-->>Relay: ownerUserId
    Relay-->>Owner: ownerGrant JWT

    Agent->>Relay: POST /api/relay/agent/auth { agentId, agentKey, ownerGrant }
    Relay->>Relay: readOwnerAgentGrant(ownerGrant)
    Relay->>Store: bindAgentToOwner(agentId, agentKey, ownerUserId)
    Relay->>Relay: issueRelayToken(type=agent)
    Relay->>Relay: state.agentSessions.set(agentId, payload)
    Relay-->>Agent: agent token
```

## 5. Client auth and pairing flow

```mermaid
sequenceDiagram
    participant Browser
    participant Relay
    participant Store as RelayOwnerBindingStore
    participant Sessions as agentSessions

    Browser->>Relay: POST /api/relay/client/auth { clientId, clientKey, ownerGrant? }
    alt ownerGrant provided
        Relay->>Relay: readOwnerAgentGrant(ownerGrant)
    else Better Auth enabled
        Relay->>Relay: readRequiredOwnerUserId(request)
    end
    Relay->>Store: findLatestAgentByOwnerUserId(ownerUserId)
    alt matching agent binding exists
        Relay->>Relay: issueRelayToken(type=client, targetId=agentId)
    else no agent binding
        Relay->>Relay: issueRelayToken(type=client)
    end
    Relay-->>Browser: client token + paired flag

    Browser->>Relay: POST /api/relay/client/heartbeat
    Relay->>Sessions: check agent session expiry
    Relay-->>Browser: paired + serverReady + transportReady
```

## 6. Browser SSE registration flow

```mermaid
sequenceDiagram
    participant Browser
    participant Relay
    participant Auth as authorization.ts
    participant BrowserMap as browserClients
    participant AgentStream as paired agent SSE

    Browser->>Relay: GET /api/client/stream?token=...
    Relay->>Auth: resolveClientRelayTarget(request)
    Auth->>Auth: read client token
    Auth-->>Relay: clientId + agentId
    Relay->>BrowserMap: replace existing client stream if present
    Relay->>Browser: SSE comment "connected"
    Relay->>BrowserMap: store connection handle
    Relay->>AgentStream: send client_connect command
    loop every 15s
        Relay->>Browser: SSE comment "ping"
    end
    Browser-->>Relay: socket closes
    Relay->>BrowserMap: remove client stream
    Relay->>AgentStream: send client_disconnect command
```

## 7. Agent SSE registration flow

```mermaid
sequenceDiagram
    participant Agent
    participant Relay
    participant AgentMap as agentConnections
    participant BrowserMap as browserClients

    Agent->>Relay: GET /api/relay/agent/stream Authorization Bearer agentToken
    Relay->>Relay: readRelayToken(token)
    Relay->>AgentMap: replace existing agent stream if present
    Relay->>Agent: SSE comment "connected"
    Relay->>AgentMap: store connection handle
    Relay->>BrowserMap: listBrowserClientsForAgent(agentId)
    loop for each already-connected browser client
        Relay->>Agent: client_connect command
    end
    loop every 15s
        Relay->>Agent: SSE comment "ping"
    end
    Agent-->>Relay: socket closes
    Relay->>AgentMap: remove agent stream
    Relay->>BrowserMap: close all paired browser streams
```

## 8. Browser message to agent flow

```mermaid
sequenceDiagram
    participant Browser
    participant Relay
    participant BrowserMap as browserClients
    participant AgentMap as agentConnections
    participant Agent

    Browser->>Relay: POST /api/client/message
    Relay->>Relay: resolveClientRelayTarget(request)
    Relay->>BrowserMap: ensure browser stream is connected
    Relay->>AgentMap: sendAgentCommand(agentId, client_message)
    alt agent stream exists
        Relay-->>Browser: 202 { ok: true }
        Agent-->>Agent: receives client_message over SSE
    else agent stream missing
        Relay-->>Browser: 503 paired agent transport unavailable
    end
```

## 9. Agent message to browser flow

```mermaid
sequenceDiagram
    participant Agent
    participant Relay
    participant BrowserMap as browserClients
    participant Browser

    Agent->>Relay: POST /api/relay/agent/message
    Relay->>Relay: readRelayToken(agentToken)
    Relay->>Relay: parseRelayAgentMessage(body)
    Relay->>BrowserMap: get client by payload.clientId
    alt client exists and belongs to same agent
        Relay->>Browser: SSE data payload.message
        Relay-->>Agent: 202 { ok: true }
    else client missing or paired elsewhere
        Relay-->>Agent: 409 Browser client stream is not connected
    end
```

## 10. Generic connection authorization flow

```mermaid
flowchart TD
    Request["POST /api/relay/connection"] --> Bearer["readBearerTokenFromRequest()"]
    Bearer --> Token["readRelayToken()"]
    Token --> Authz["authorizeRelayConnection(principal, request)"]
    Authz --> Match{"Target type/id<br/>match token scope?"}
    Match -->|Yes| Ok["200 connection payload"]
    Match -->|No| Forbidden["403 scoped target mismatch"]
    Token -->|bad token| Unauthorized["401 invalid token"]
```

## 11. Route ownership map

```mermaid
flowchart TD
    Routes["createRelayRequestHandler()"] --> AuthRoutes["/api/auth/* -> Better Auth handler"]
    Routes --> Health["/ and /health -> buildHealthPayload"]
    Routes --> ClientAuth["/api/relay/client/auth -> parseClientAuthRequest + issueClientToken"]
    Routes --> ClientHeartbeat["/api/relay/client/heartbeat -> buildClientHeartbeatResponse"]
    Routes --> OwnerGrant["/api/relay/agent/owner-grant -> generateOwnerAgentGrant"]
    Routes --> AgentAuth["/api/relay/agent/auth -> parseAgentAuthRequest + issueAgentToken"]
    Routes --> AgentStream["/api/relay/agent/stream -> handleAgentStreamRequest"]
    Routes --> AgentMessage["/api/relay/agent/message -> handleAgentMessageRequest"]
    Routes --> ClientStream["/api/client/stream -> registerBrowserClientStream"]
    Routes --> ClientMessage["/api/client/message -> handleClientMessageRequest"]
    Routes --> Connection["/api/relay/connection -> authorizeRelayConnection"]
```
