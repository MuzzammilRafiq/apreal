This is a monorepo

- relay server => apps/relay-server (middleman between hosted web client and agent server)
- server => apps/server (runs on the user's laptop)
- web => apps/web (browser frontend for the local server UI and hosted remote UI)
- Do not run any computer-use/browser automation or take website screenshots yourself; the user will test the website manually.

## Current Progress

- Monorepo foundation is in place with `apps/web`, `apps/server`, `apps/relay-server`, and `apps/shared`.
- Local chat is working with persisted sessions, provider/model settings, MCP server management, system prompt append support, and scheduled jobs.
- Remote account sign-in, automatic owner pairing, singleton agent/client takeover, and hosted chat transport are implemented, but production hardening for the remote surface is still in progress.
- Chat sync now keeps sidebar/session metadata live across connected clients while full transcript snapshots are loaded lazily per opened session, with browser cache revision tracking for stale transcripts.
- Chat management now exposes per-chat deletion in the sidebar and a settings action to delete all normal chat sessions across connected clients.
- Active chat runs can be stopped from the web composer through the Pi SDK abort path.
- The main chat screen now uses shadcn/ui plus AI Elements primitives for the conversation, messages, and prompt input, and the web surface is temporarily reduced to a black-and-white theme while accent colors are removed.
- The chat composer now uses a fuller AI Elements `PromptInput` layout with session status, active model, context usage, and shortcut guidance while remaining text-only until attachments are wired end-to-end.
- Assistant transcript rendering now groups reasoning and tool activity into a cleaner collapsible chain-of-thought block, with bash commands shown in a more terminal-like presentation and tool status surfaced inline.
- The web component layer has been pruned to remove unused AI Elements wrapper components, unreferenced shadcn/ui helpers, and orphaned SVG assets so the current UI surface matches what is actually rendered.
- The chat composer now keeps the current model visible as an inline picker in the input footer, supports switching models without leaving chat, and uses a lighter thin-border treatment for a simpler chat surface.
- Update this section after every major project change; skip minor changes.
