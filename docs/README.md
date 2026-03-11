# docs index

Last updated: 2026-03-12

This folder stores development notes for `chat-adapter-qq`.

## Recommended reading order

1. `2026-03-12-qq-adapter-current-status.md` (single-source snapshot)
2. Topic docs (message parsing / heartbeat / member queries)
3. Historical baseline docs (MVP and interface completion)

## Current docs

- `2026-03-12-qq-adapter-current-status.md`
  - Current implementation snapshot: capability matrix, key behaviors, and test coverage map.
- `2026-03-12-qq-adapter-heartbeat.md`
  - Heartbeat architecture and failure/reconnect policy.
- `2026-03-11-qq-adapter-message-markdown-parsing.md`
  - Inbound NapCat segment -> Markdown/AST/plain-text conversion rules.
- `2026-03-11-qq-adapter-member-queries.md`
  - QQ-specific member query APIs and unified profile mapping.

## Historical docs

- `2026-03-10-qq-adapter-mvp-baseline.md`
  - MVP assumptions and original scope.
- `2026-03-11-qq-adapter-interface-completion.md`
  - Interface completion phase notes for the March 11 milestone.

## Reference docs

- `2026-03-11-qq-adapter-emoji-unicode.md`
  - Chat built-in emoji names and Unicode decimal code points.

## Maintenance notes

- Keep new files under `docs/` with naming: `YYYY-MM-DD-topic.md`.
- Prefer writing status explicitly (`current` / `historical`) near document top.
- When behavior changes, update:
  - `2026-03-12-qq-adapter-current-status.md`
  - the corresponding topic doc (if affected)
