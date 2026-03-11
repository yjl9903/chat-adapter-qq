# Repository Guidelines

## Project Structure & Module Organization

This repository is a `pnpm` workspace with packages under `packages/*`.  
The main implementation lives in `packages/chat-adapter-qq/`.

- Source code: `packages/chat-adapter-qq/src` (`adapter.ts`, `factory.ts`, `converter/index.ts`, `heartbeat.ts`, etc.)
- Tests: `packages/chat-adapter-qq/test` (`adapter-basics.test.ts`, `messaging-apis.test.ts`, `thread-member-queries.test.ts`, `message-parsing.test.ts`, `napcat-mock.ts`)
- Example usage: `examples/chat.ts`
- Notes/design docs: `docs/`

Build artifacts are generated to `packages/chat-adapter-qq/dist` by `tsdown`.

## Documentation

Index of project development documentation under `docs/`:

- `docs/README.md`: docs index and maintenance notes
- `docs/2026-03-12-qq-adapter-current-status.md`: current adapter implementation snapshot
- `docs/2026-03-12-qq-adapter-heartbeat.md`: heartbeat architecture and reconnect policy
- `docs/2026-03-11-qq-adapter-message-markdown-parsing.md`: inbound parsing pipeline and mapping rules
- `docs/2026-03-11-qq-adapter-member-queries.md`: QQ-specific member query APIs
- `docs/2026-03-11-qq-adapter-emoji-unicode.md`: emoji name/codepoint reference
- `docs/2026-03-11-qq-adapter-interface-completion.md`: historical interface-completion milestone notes
- `docs/2026-03-10-qq-adapter-mvp-baseline.md`: historical MVP baseline

Add new development documents in `docs/` and use the `YYYY-MM-DD-topic.md` naming pattern.

## Build, Test, and Development Commands

Run commands from repository root unless noted.

- `pnpm install`: install workspace dependencies (Node `>=20.10.0`)
- `pnpm build`: build all packages via Turbo (`turbo run build`)
- `pnpm dev`: run dev tasks in parallel for active packages
- `pnpm typecheck`: run TypeScript checks across workspace
- `pnpm test:ci`: run CI test pipeline (`build` + `typecheck` + test run)
- `pnpm format`: format `*.ts/*.js/*.mjs` with Prettier
- `pnpm --filter chat-adapter-qq test`: run Vitest in watch mode for this package

## Coding Style & Naming Conventions

TypeScript is configured in strict mode (`tsconfig.json`). Follow existing ESM style and keep public API types explicit.

- Formatting: Prettier (`semi: true`, `singleQuote: true`, `printWidth: 100`, `trailingComma: none`)
- Indentation: 2 spaces
- File names: lower-case, use kebab-case when multi-word (for example, `cached-client.ts`)
- Tests: `*.test.ts` suffix

Prefer small, focused modules in `src/` and keep adapter behavior (thread IDs, NapCat mapping, message conversion) covered by tests.

## Testing Guidelines

Tests use Vitest (`environment: node`, `globals: true`). Coverage uses V8 with `text` and `json-summary` reporters and targets `src/**/*.ts`.

- Run all tests: `pnpm test:ci`
- Run package tests locally: `pnpm --filter chat-adapter-qq test`

When changing adapter logic, add or update focused tests in `packages/chat-adapter-qq/test/*.test.ts` (for example, `messaging-apis.test.ts`, `thread-member-queries.test.ts`, `message-parsing.test.ts`) and use `napcat-mock.ts` for protocol-facing behavior.

## Commit & Pull Request Guidelines

Use Conventional Commit style, consistent with current history:

- `feat: ...`
- `fix(qq): ...`
- `refactor(qq): ...`
- `chore: ...`

For pull requests, include:

- Clear summary of behavior changes
- Linked issue (if applicable)
- Test evidence (command + result, e.g. `pnpm test:ci`)
- Updates to docs/examples when public API or usage changes
