# desktop

This repo is now structured as a small monorepo so the desktop surface can grow into multiple apps without another reorganization.

## Layout

- `apps/web`: React + Vite browser client.
- `apps/server`: Bun server that owns the Pi SDK session runtime and WebSocket transport.
- `docs`: markdown documentation and notes.
- `mobile/react-native`: planned for later, not scaffolded yet.

## Install

```bash
bun install
```

## Development

Run the Bun server:

```bash
bun run dev:server
```

Run the React web app:

```bash
bun run dev:web
```

Run both together:

```bash
bun run dev
```

`bun run dev` uses Turbo's TUI so the server and web tasks show up as separate selectable streams in the terminal.

If you want plain prefixed terminal output instead of the TUI, use:

```bash
bun run dev:plain
```

If you want separate log files on disk, use:


```bash
bun run dev:logs
```

That runner writes to:

- `dev/logs/server.log`
- `dev/logs/web.log`

The server listens on `http://localhost:3000` by default and exposes:

- `GET /health`
- `POST /api/relay/bootstrap`

The browser UI is only served by the Vite app at `http://localhost:5173` in development. The Bun server no longer serves frontend assets. Set `VITE_PI_SERVER_URL` if you want the web app to connect to a different server origin.

## Build And Checks

```bash
bun run build
bun run typecheck
```

## Runtime Notes

- Put `OPENROUTER_API_KEY` in your shell or `.env.local`.
- `LOG_LEVEL` supports `debug`, `info`, `warn`, and `error`.
- The laptop-side server always connects through the relay server.
- The browser persists a random `clientId` in local storage and fetches a short-lived client JWT from the server before opening the relay socket.
- `VITE_PI_BOOTSTRAP_URL` can point the browser at a deployed bootstrap origin when the JWT-issuing app server is not on the same origin as the relay WebSocket URL.
- `JWT_SECRET` must match between `apps/server` and `apps/relay-server` when relay mode is enabled because the server mints client JWTs that the relay verifies.
- The browser no longer requires a bundled `VITE_PI_RELAY_TOKEN` for normal relay mode.
- Browser chats stay shared in memory across tabs while the server is running.
- CLI mode was removed; configuration now flows through the web client only.
