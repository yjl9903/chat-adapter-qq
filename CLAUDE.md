# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from repository root unless noted.

```bash
pnpm install                              # install workspace dependencies (Node >=20.10.0)
pnpm build                               # build all packages via Turbo
pnpm typecheck                           # TypeScript checks across workspace
pnpm test:ci                             # build + typecheck + full test run
pnpm format                              # Prettier format *.ts/*.js/*.mjs
pnpm --filter chat-adapter-qq test       # Vitest watch mode for QQ adapter
pnpm --filter chat-adapter-sqlite test   # Vitest watch mode for SQLite adapter
```

## Architecture

This is a pnpm monorepo with two packages under `packages/`:

- **`chat-adapter-qq`** — QQ messaging adapter for [Chat SDK](https://chat-sdk.dev/). Connects to a [NapCat](https://napneko.github.io/) WebSocket server via `node-napcat-ts` and implements the Chat SDK `Adapter<QQThreadId, QQRawMessage>` interface. Thread IDs are encoded as `qq:group:{id}` or `qq:private:{id}`.
- **`chat-adapter-sqlite`** — SQLite-backed `StateAdapter` for Chat SDK. Supports key-value cache, distributed locks, thread subscriptions, and list operations using `better-sqlite3`.

### chat-adapter-qq internals

| File                          | Role                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `src/adapter.ts`              | `QQAdapter` — main adapter class, message routing, thread management  |
| `src/factory.ts`              | `createQQAdapter()` — validated factory entry point                   |
| `src/types.ts`                | `QQThreadId`, `QQRawMessage`, `QQAdapterConfig`, etc.                 |
| `src/converter/index.ts`      | `QQFormatConverter` — NapCat message segments → Markdown/AST          |
| `src/heartbeat.ts`            | `QQNapcatConnectionHeartbeat` — periodic health check, auto-reconnect |
| `src/napcat/cached-client.ts` | `CachedNCWebsocket` — LRU-cached wrapper around the NapCat WS client  |
| `src/emoji.ts`                | QQ emoji ID → Chat SDK emoji normalization                            |
| `src/utils.ts`                | Thread ID encode/decode, author mapping, message classification       |

Tests live in `packages/chat-adapter-qq/test/`. `napcat-mock.ts` and `test-context.ts` are shared test utilities; all protocol-facing behavior should be covered through these mocks.

### Build

Both packages use `tsdown` to build dual ESM (`.mjs`) + CJS (`.cjs`) bundles with declaration files into `dist/`. `chat-adapter-qq` bundles `node-napcat-ts` directly (see `tsdown.config.ts`). `node-napcat-ts` has a local patch at `patches/node-napcat-ts.patch`.

## Coding Conventions

- Strict TypeScript; keep public API types explicit.
- Prettier: `semi: true`, `singleQuote: true`, `printWidth: 100`, `trailingComma: none`, 2-space indent.
- File names: kebab-case (e.g. `cached-client.ts`), tests use `*.test.ts` suffix.
- Conventional Commits: `feat:`, `fix(qq):`, `refactor(qq):`, `chore:`, etc.

## Documentation

Development notes live in `docs/` using `YYYY-MM-DD-topic.md` naming. See `docs/README.md` for the index. Key docs:

- `docs/2026-03-12-qq-adapter-current-status.md` — current implementation snapshot
- `docs/2026-03-12-qq-adapter-heartbeat.md` — heartbeat/reconnect architecture
- `docs/2026-03-11-qq-adapter-message-markdown-parsing.md` — inbound message parsing pipeline
- `docs/2026-03-11-qq-adapter-member-queries.md` — QQ member query APIs
