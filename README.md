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

Run both the Node server and the React web app together:

```bash
pnpm dev
```

`pnpm dev` uses Turbo's TUI so the server and web tasks show up as separate selectable streams in the terminal.

This is the only development mode with frontend hot reload. Edit files under `apps/web/src`, keep the browser open at `http://localhost:5173`, and Vite will reload without rebuilding `apps/web/dist` or restarting the server.

If you want to run just one side, use:

```bash
pnpm dev:server
pnpm dev:web
```

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

In development, the browser UI should be opened from the Vite app at `http://localhost:5173` so HMR works. The Node server still serves built frontend assets from `apps/web/dist` when that bundle exists, but that path does not hot reload.

## Build And Checks

```bash
pnpm build
pnpm typecheck
```

## Runtime Notes

- Agent provider login is handled by the Apreal settings UI on the laptop. Credentials and defaults are stored under `~/.apreal/agent` by default.
- The server exposes a persistent Markdown-backed `memory` tool. `always` memory is one file at `~/.apreal/agent/memory/always.md` and is loaded into each session when non-empty. `search` memory lives in up to 10 Markdown files under `~/.apreal/agent/memory/search`; only the file index is loaded by default, and the agent reads individual files on demand. Keep every memory file at 50 lines or fewer.
- `LOG_LEVEL` supports `debug`, `info`, `warn`, and `error`.
- The browser talks only to the relay host for auth plus chat transport.
- The browser talks only to the relay host. The Pi server keeps an outbound authenticated stream open to the relay, and browser messages are forwarded over that live channel.
- `JWT_SECRET` is only required by `apps/relay-server` for relay token verification and local token generation.
- Browser chats stay shared in memory across tabs while the server is running.
- CLI mode was removed; configuration now flows through the web client only.
