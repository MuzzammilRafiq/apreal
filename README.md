# desktop

This repo is now structured as a small monorepo so the desktop surface can grow into multiple apps without another reorganization.

## Layout

- `apps/web`: React + Vite browser client.
- `apps/server`: Node.js server that owns the Pi SDK session runtime and the browser HTTP/SSE transport.
- `apps/relay-server`: Node.js relay server for authenticated browser-to-agent traffic.
- `apps/shared`: shared TypeScript package consumed by the server and web apps.
- `docs`: markdown documentation and notes.
- `apps/mobile`: mobile app workspace, currently out of scope for the desktop flow.

## Install

```bash
pnpm install
```

Use Node.js 20.6 or newer.

## Development

Run the Node server:

```bash
pnpm dev:server
```

Run the React web app:

```bash
pnpm dev:web
```

Run both together:

```bash
pnpm dev
```

`pnpm dev` uses Turbo's TUI so the server and web tasks show up as separate selectable streams in the terminal.

If you want plain prefixed terminal output instead of the TUI, use:

```bash
pnpm dev:plain
```

If you want separate log files on disk, use:


```bash
pnpm dev:logs
```

That runner writes to:

- `dev/logs/server.log`
- `dev/logs/web.log`

The server listens on `http://localhost:3000` by default and exposes:

- `GET /health`
- `GET /api/client/stream`
- `POST /api/client/message`
- `POST /api/relay/connection`

The browser UI is only served by the Vite app at `http://localhost:5173` in development. The Node server does not serve frontend assets. The browser should point `VITE_PI_RELAY_URL` at the relay host, and the Pi server opens an outbound authenticated stream to that relay for browser traffic.

## Build And Checks

```bash
pnpm build
pnpm typecheck
```

## Runtime Notes

- Put `OPENROUTER_API_KEY` in your shell or `.env.local`.
- `LOG_LEVEL` supports `debug`, `info`, `warn`, and `error`.
- The browser talks only to the relay host for auth plus chat transport.
- The browser talks only to the relay host. The Pi server keeps an outbound authenticated stream open to the relay, and browser messages are forwarded over that live channel.
- `JWT_SECRET` is only required by `apps/relay-server` for relay token verification and local token generation.
- Browser chats stay shared in memory across tabs while the server is running.
- CLI mode was removed; configuration now flows through the web client only.
