# Pi Monorepo: Where To Look
# Located at ~/Code/downloads/pi-mono
This is a navigation guide for the `pi-mono` repo, written with one goal in mind: help you quickly find the right place to read when building a custom agent around pi.

## First Important Note

This repo is **TypeScript/Node-first**.

- The main embedding surface is the `pi-coding-agent` SDK.
- There is **RPC support with a Python example**.
- There is **not** an obvious first-party `py-sdk` package in this repository.

If by "py-sdk" you mean a Python-native wrapper around pi, the most relevant part of this repo is usually **RPC mode**, not a dedicated Python package.

## Start Here For Your Use Case

If you want to build a custom agent and need to know where to begin, use this order:

1. `packages/coding-agent/docs/sdk.md`
2. `packages/coding-agent/examples/sdk/`
3. `packages/coding-agent/src/core/sdk.ts`
4. `packages/coding-agent/src/index.ts`
5. `packages/coding-agent/docs/rpc.md`
6. `packages/coding-agent/src/modes/rpc/`

Reason:

- `docs/sdk.md` explains the supported programmatic integration model.
- `examples/sdk/` shows the intended usage patterns faster than reading internals first.
- `src/core/sdk.ts` is the real session-construction logic.
- `src/index.ts` shows the public API surface exported by the package.
- `docs/rpc.md` matters if your Python side will control pi as a subprocess.
- `src/modes/rpc/` matters if you need to understand the wire protocol or extend it.

## Repo At A Glance

### Root files

- `README.md`: top-level overview of the monorepo and package list.
- `AGENTS.md`: project rules and implementation guidance for contributors and agents.
- `CONTRIBUTING.md`: contribution gate and repo philosophy.
- `package.json`: workspace layout and build/check scripts.
- `scripts/`: release, profiling, browser smoke, transcript, and version-sync utilities.
- `.github/workflows/`: CI, contributor gates, binary builds.

### Main packages

- `packages/coding-agent`: the actual pi coding agent product, CLI, SDK, RPC, extensions, sessions, built-in tools.
- `packages/agent`: lower-level agent runtime loop and event model.
- `packages/ai`: provider/model abstraction layer for streaming, tools, auth, and model definitions.
- `packages/tui`: terminal UI framework used by the interactive agent.
- `packages/web-ui`: reusable browser chat UI components.
- `packages/mom`: Slack bot integration built on top of pi.
- `packages/pods`: deployment tooling for model hosting and GPU pods.

## Where To Look By Question

### "I want to embed pi in my own app"

Look here first:

- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/examples/sdk/README.md`
- `packages/coding-agent/examples/sdk/01-minimal.ts`
- `packages/coding-agent/examples/sdk/12-full-control.ts`
- `packages/coding-agent/src/core/sdk.ts`
- `packages/coding-agent/src/index.ts`

What lives there:

- `createAgentSession()` and `createAgentSessionRuntime()`
- SDK options for cwd, tools, settings, sessions, prompts, extensions, auth, and models
- the exported public API you are expected to use from outside the package

### "I am using Python and need to drive pi from another process"

Look here first:

- `packages/coding-agent/docs/rpc.md`
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- `packages/coding-agent/src/modes/rpc/rpc-types.ts`
- `packages/coding-agent/src/modes/rpc/rpc-client.ts`
- `packages/coding-agent/examples/rpc-extension-ui.ts`

What lives there:

- the JSONL RPC protocol
- commands like prompt, state inspection, model switching, bash, compaction, and session control
- a Python example client in the docs

If your plan is "Python app controls pi," this is the most important area after the SDK docs.

### "I want to understand session creation and lifecycle"

Look here first:

- `packages/coding-agent/src/core/sdk.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/agent-session-runtime.ts`
- `packages/coding-agent/src/core/agent-session-services.ts`
- `packages/coding-agent/src/core/session-manager.ts`
- `packages/coding-agent/docs/session.md`

What lives there:

- how a session is created
- how models and settings are resolved
- how sessions are persisted, restored, forked, and switched

### "I want to change or add built-in tools"

Look here first:

- `packages/coding-agent/src/core/tools/`
- `packages/coding-agent/src/core/sdk.ts`
- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/docs/extensions.md`

Important files inside `src/core/tools/`:

- `bash.ts`
- `read.ts`
- `edit.ts`
- `write.ts`
- `find.ts`
- `grep.ts`
- `ls.ts`
- `tool-definition-wrapper.ts`
- `file-mutation-queue.ts`

What lives there:

- built-in tool definitions
- execution behavior
- edit/write safety logic
- helper factories for custom cwd usage from the SDK

### "I want custom tools, hooks, commands, or UI"

Look here first:

- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/src/core/extensions/`
- `packages/coding-agent/examples/extensions/`

Use `examples/extensions/` when you want patterns faster than theory.

Good examples to inspect:

- custom providers: `custom-provider-anthropic`, `custom-provider-gitlab-duo`, `custom-provider-qwen-cli`
- workflow/safety: `permission-gate.ts`, `confirm-destructive.ts`, `dirty-repo-guard.ts`
- session/workflow additions: `todo.ts`, `plan-mode/`, `subagent/`
- UI: `custom-footer.ts`, `custom-header.ts`, `modal-editor.ts`, `status-line.ts`, `message-renderer.ts`

### "I want to change prompts, skills, context files, or slash commands"

Look here first:

- `packages/coding-agent/docs/skills.md`
- `packages/coding-agent/docs/prompt-templates.md`
- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/src/core/skills.ts`
- `packages/coding-agent/src/core/prompt-templates.ts`
- `packages/coding-agent/src/core/resource-loader.ts`
- `packages/coding-agent/src/core/slash-commands.ts`
- `packages/coding-agent/src/core/system-prompt.ts`

What lives there:

- resource discovery
- loading/merging behavior
- prompt assembly
- provenance/source tracking for skills, tools, and commands

### "I want to understand models, providers, auth, or custom provider wiring"

Look here first:

- `packages/coding-agent/docs/providers.md`
- `packages/coding-agent/docs/models.md`
- `packages/coding-agent/docs/custom-provider.md`
- `packages/coding-agent/src/core/model-registry.ts`
- `packages/coding-agent/src/core/model-resolver.ts`
- `packages/coding-agent/src/core/auth-storage.ts`
- `packages/ai/src/`
- `packages/ai/src/providers/`

What lives there:

- built-in provider/model discovery
- API keys and OAuth handling
- custom model config via `models.json`
- provider implementations for Anthropic, OpenAI, Google, Mistral, Bedrock, and others

If you need to add a new provider or understand transport behavior, `packages/ai` is the real implementation layer.

### "I want to understand the lower-level agent loop, independent of pi's CLI"

Look here first:

- `packages/agent/README.md`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/types.ts`

What lives there:

- the generic agent runtime
- tool execution loop
- event model used by higher-level UIs and wrappers

This package matters if you want the engine without all of pi's CLI/session/customization layers.

### "I want to understand the CLI and interactive app"

Look here first:

- `packages/coding-agent/src/cli.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/src/cli/`
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/index.ts`

What lives there:

- process entrypoints
- argument parsing
- mode selection
- interactive startup flow

### "I want to understand the terminal UI layer"

Look here first:

- `packages/tui/README.md`
- `packages/tui/src/`
- `packages/tui/src/components/`

This is useful when the question is about rendering, overlays, editor widgets, keyboard handling, or terminal behavior rather than agent logic.

### "I want a browser UI instead of the terminal"

Look here first:

- `packages/web-ui/README.md`
- `packages/web-ui/src/`
- `packages/web-ui/example/`

This package is relevant if you want a web chat shell around `pi-agent-core` and `pi-ai` rather than the terminal coding agent.

### "I want integration examples from a real app"

Look here first:

- `packages/mom/`

Why:

- it shows how pi can be integrated into another application workflow, especially around messaging, sandboxing, and orchestration

### "I want deployment/inference infrastructure, not agent behavior"

Look here first:

- `packages/pods/`
- `packages/pods/docs/`

This area is mainly about model hosting and pod management, not custom agent behavior.

## Best Reading Order For A Custom Agent Builder

If your goal is a custom agent around pi, read in this order:

1. `README.md`
2. `packages/coding-agent/README.md`
3. `packages/coding-agent/docs/sdk.md`
4. `packages/coding-agent/examples/sdk/`
5. `packages/coding-agent/docs/extensions.md`
6. `packages/coding-agent/examples/extensions/`
7. `packages/coding-agent/docs/rpc.md`
8. `packages/coding-agent/src/core/sdk.ts`
9. `packages/coding-agent/src/core/agent-session.ts`
10. `packages/coding-agent/src/core/extensions/`
11. `packages/coding-agent/src/core/tools/`
12. `packages/ai/src/` and `packages/agent/src/` only when you need deeper internals

## Practical Shortcuts

### If you only need the public surface

Start with:

- `packages/coding-agent/src/index.ts`

That file is the cleanest way to see what the package intentionally exports.

### If you only need usage examples

Start with:

- `packages/coding-agent/examples/sdk/`
- `packages/coding-agent/examples/extensions/`

### If you only need Python interoperability

Start with:

- `packages/coding-agent/docs/rpc.md`

### If you only need model/provider internals

Start with:

- `packages/ai/src/providers/`

## Usually Lower Priority For Your Specific Goal

You can usually defer these until later:

- `packages/pods/`: deployment tooling, not core agent behavior
- `.github/workflows/`: CI/contributor gates
- `scripts/`: release and maintenance tasks
- `packages/tui/`: only needed for terminal rendering changes
- `packages/web-ui/`: only needed if you want browser UI

## One-Sentence Summary

For a custom agent builder, `packages/coding-agent` is the center of gravity, `packages/ai` is the provider layer underneath it, `packages/agent` is the lower-level runtime, and Python integration in this repo is primarily through RPC rather than a dedicated Python SDK package.