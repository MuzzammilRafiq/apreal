# Relay Architecture Notes

## Why This Changed

The original browser-to-agent path depended on the relay calling back into the Pi server by URL.

That model looked like this:

```text
Browser -> Relay -> Pi server URL -> Agent runtime
```

This created a real deployment problem for the common case where the Pi server runs on a laptop:

- A public relay can reach the browser.
- A public relay cannot directly reach `localhost` on the laptop.
- That forced the server to publish `PI_SERVER_URL`, even though the agent itself always ran locally.

That made local development awkward and was the wrong transport model for a laptop-hosted agent.

## New Architecture

The transport now uses an outbound authenticated connection from the Pi server to the relay.

The new model looks like this:

```text
Browser -> Relay -> outbound agent stream -> Pi server -> Agent runtime
```

More concretely:

1. The browser authenticates with the relay and receives a client token.
2. The Pi server authenticates with the relay and receives an agent token.
3. The Pi server opens a long-lived SSE connection to the relay.
4. The relay keeps browser-facing endpoints stable.
5. Browser messages are forwarded to the Pi server over the live relay-agent channel.
6. The Pi server sends server messages back to the relay over an authenticated POST endpoint.
7. The relay forwards those messages to the browser SSE stream.

This is much closer to how practical messaging systems work for non-public devices: the private device opens an outbound connection instead of waiting for the public service to dial it directly.

## What Changed In Code

### Shared Protocol

New shared relay transport types and paths were added so the server and relay speak one explicit protocol:

- `RELAY_AGENT_STREAM_PATH`
- `RELAY_AGENT_MESSAGE_PATH`
- `RelayAgentCommand`
- `RelayAgentMessage`

These live in `apps/shared/src/index.ts`.

### Relay Server

The relay was changed from callback-URL proxying to in-memory connection brokering.

Before:

- Relay received browser `GET /api/client/stream`
- Relay received browser `POST /api/client/message`
- Relay looked up `serverUrl`
- Relay made HTTP requests to the Pi server

After:

- Relay still receives browser `GET /api/client/stream`
- Relay still receives browser `POST /api/client/message`
- Relay now also exposes:
  - `GET /api/relay/agent/stream`
  - `POST /api/relay/agent/message`
- Relay keeps live browser-client and agent connection registries in memory
- Relay forwards browser connect, disconnect, and message commands over the agent stream
- Relay forwards Pi server messages back to the correct browser stream

This work lives primarily in `apps/relay-server/src/index.ts`.

### Pi Server

The Pi server was changed so it no longer needs an inbound public URL for relay traffic.

Before:

- Pi server authenticated with relay
- Pi server registered `PI_SERVER_URL`
- Relay proxied browser traffic to that URL

After:

- Pi server authenticates with relay
- Pi server opens an outbound authenticated SSE stream to the relay
- Pi server consumes relay commands from that stream
- Pi server reuses the existing internal client/session logic
- Pi server posts browser-facing messages back to the relay

This work lives mainly in:

- `apps/server/src/relay-auth.ts`
- `apps/server/src/web.ts`

### Browser / Web App

Two important browser-side fixes were made.

#### 1. Local Dev Proxy

In development, the web app now uses same-origin `/api/...` requests through Vite instead of making the browser open cross-origin SSE directly to the remote relay.

That change avoids noisy Firefox cross-origin SSE failures during local development.

This lives in:

- `apps/web/src/transport-config.ts`
- `apps/web/vite.config.ts`

#### 2. EventSource Reconnect Loop Fix

There was also a React effect bug in the browser app.

The EventSource effect depended on callbacks whose identity changed when connection state changed. That caused React to tear down the live stream and recreate it repeatedly, which showed up in server logs as rapid connect/disconnect loops.

That was fixed by using stable refs for the latest handlers and keeping the EventSource effect dependencies narrow.

This lives in `apps/web/src/App.tsx`.

## Resulting Runtime Shape

The current runtime behavior is:

```text
Browser
  -> Relay client auth
  -> Relay client SSE stream
  -> Relay client message POST

Pi server
  -> Relay agent auth
  -> Relay agent SSE stream
  -> Relay agent message POST

Relay
  -> maps browser client <-> paired agent
  -> forwards messages across both live channels
```

## Current Simplifications

This version was intentionally kept simple.

It does not currently try to handle:

- offline queueing
- durable delivery
- multiple relay nodes sharing connection state
- resumable browser streams
- resumable agent streams
- message persistence in the relay

If either side disconnects, traffic stops until reconnect.

That simplicity is fine for development and early production if the goal is a live paired browser-to-laptop experience.

## Security Gaps To Close Before Production

The transport is now functionally correct, but production hardening still needs deliberate work.

### 1. Stop Putting Long-Lived Bearer Tokens In Query Strings

Right now the browser stream uses a token in the query string for EventSource.

That is risky because query strings can leak through:

- browser history
- logs
- reverse proxies
- crash reports
- monitoring systems

Better options:

- use a short-lived one-time stream ticket minted from a normal authenticated POST
- or move browser auth to secure `HttpOnly` cookies with `SameSite` protection
- or replace EventSource with `fetch()` streaming if you want header-based bearer auth

This is one of the highest-priority production fixes.

### 2. Shorten Token Lifetimes

Current relay tokens are long-lived.

For production, prefer:

- short-lived access tokens
- refresh or re-issue flow
- scoped tokens for stream vs message endpoints
- rotation on reconnect

Long-lived relay tokens increase the blast radius of theft.

### 3. Bind Browser Sessions More Tightly

The browser client identity is durable and local-storage backed.

For stronger production posture:

- treat browser auth as a real session
- rotate client tokens regularly
- consider explicit browser-session invalidation
- consider device/session metadata and revocation

### 4. Tighten CORS

The relay currently allows broad CORS for development convenience.

For production, replace `*` with an explicit allowlist of trusted origins.

At minimum:

- production web origin
- staging origin if needed
- local development origin only in development

### 5. Add Rate Limits

Add rate limits at the relay for:

- auth endpoints
- pairing attempts
- browser message POSTs
- agent message POSTs
- connection checks

Without rate limiting, the relay is too easy to abuse.

### 6. Harden Pairing

Pairing codes are simple and practical, but production systems usually need more controls.

Add:

- pairing expiration windows
- maximum retry counts
- replay protection
- audit logging for successful and failed pairing attempts
- optional one-time-use enforcement that is durable across restarts

### 7. Protect Relay State Better

The relay currently keeps live connection state in memory and stores issued tokens on disk.

For production:

- secure file permissions on the token store
- consider encrypted at-rest storage for long-lived secrets
- consider moving token/session state into a proper backing store
- define operational rotation for `JWT_SECRET`

### 8. Improve Observability Without Leaking Secrets

Production logging should never leak tokens or pairing secrets.

Add:

- structured logs with request IDs
- connection lifecycle metrics
- auth failure counters
- stream disconnect counters
- redaction rules for tokens and sensitive fields

### 9. Validate Origin And Intent More Strictly

For browser-originated requests, add additional controls such as:

- origin validation
- optional CSRF defenses if cookies are introduced
- endpoint-specific auth scopes
- session-to-agent binding checks

### 10. Consider WebSocket Or QUIC Later

SSE plus POST is simple and good for the current stage.

For larger scale or richer production needs, a full-duplex channel such as WebSocket may become cleaner, especially if you later want:

- acknowledgements
- heartbeats both ways
- resumable streams
- lower overhead for bidirectional traffic

That is not required immediately, but it is a likely later step.

## Recommended Production Roadmap

If the goal is "production ready with the smallest reasonable next steps", do these first:

1. Remove query-string bearer tokens from browser streams.
2. Shorten token TTLs and add refresh/re-issue.
3. Lock down CORS to explicit origins.
4. Add rate limiting and pairing-attempt protections.
5. Add structured logging and secret redaction.
6. Add token/session revocation support.
7. Move sensitive relay state to a more robust backing store.

## Bottom Line

The main architecture change was this:

- old: relay calls the Pi server by URL
- new: Pi server calls out to the relay and stays connected

That change removed the need for `PI_SERVER_URL` in the normal laptop-hosted agent path, made local development much more natural, and aligned the system better with how real-time messaging systems usually connect private devices.