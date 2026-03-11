# qq adapter current status - 2026-03-12

Status: `current`

## Scope

This document is the current implementation snapshot for `packages/chat-adapter-qq`.
It should be updated when runtime behavior, adapter APIs, or test coverage changes.

## Key implementation files

- Adapter runtime: `packages/chat-adapter-qq/src/adapter.ts`
- Inbound converter: `packages/chat-adapter-qq/src/converter/index.ts`
- Member/profile mapping helpers: `packages/chat-adapter-qq/src/utils.ts`
- Emoji normalization: `packages/chat-adapter-qq/src/emoji.ts`
- Heartbeat manager: `packages/chat-adapter-qq/src/heartbeat.ts`
- Cached NapCat client: `packages/chat-adapter-qq/src/napcat/cached-client.ts`

## Capability matrix

### Core adapter flow

- Ingress mode: NapCat WebSocket only (`handleWebhook` returns `501`).
- Thread model: conversation-as-thread
  - group: `qq:group:{group_id}`
  - private: `qq:private:{user_id}`
- Mention semantics:
  - group: only when incoming segments contain `at selfId` (excluding `@all`)
  - private: always treated as mention
- Self-message filtering: bot messages are dropped before Chat SDK handler flow.

### Messaging APIs

- `postMessage`: supported for group/private via `send_group_msg` / `send_private_msg`.
- `deleteMessage`: supported via `delete_msg`.
- `editMessage`: explicitly unsupported (`NotImplementedError`).
- `addReaction` / `removeReaction`: supported via `set_msg_emoji_like`.
- `startTyping`:
  - private: supported via `set_input_status`
  - group: no-op

### Query APIs

- `fetchMessages`: supported for group/private with cursor pagination and direction.
- `fetchMessage`: supported (`get_msg` + thread consistency check).
- `fetchThread`: supported with API-backed metadata for group/private.
- `fetchChannelInfo` / `fetchChannelMessages`: supported (delegates to thread methods).
- `openDM`: supported (returns encoded `qq:private:{userId}`).

### QQ-specific member APIs

- `fetchThreadMembers`
- `fetchThreadMember`
- `fetchChannelMembers`
- `fetchChannelMember`

Group chats query NapCat member APIs directly.
Private chats build a 2-member view (`self + peer`) from `get_login_info` + friend/stranger lookup.

### Heartbeat and reconnect

- Heartbeat starts after successful adapter initialization.
- Health probe: `get_status()`.
- Unhealthy when request fails or `online/good` is false.
- Threshold-based reconnect with in-flight dedup and recovery guard.

### Caching

- Adapter uses `CachedNCWebsocket` by default.
- Read APIs are memoized with TTL + in-flight request dedup.
- Selected write APIs invalidate related cache keys.

## Inbound message conversion (current behavior)

Pipeline:
`NapCat segments -> markdown -> parseMarkdown -> toPlainTextPreserveBreaks`

Highlights:

- `text`, `at`, `image`, `file`, `video`, `record`, `reply`, `forward`, `markdown` are handled.
- `reply`:
  - sync parse: placeholder quote
  - async parse: resolves via `get_msg` when possible
- standalone `forward`:
  - async parse resolves current message via `get_msg` and uses expanded content
  - fallback to placeholder on failure
- `rps` / `poke` / `shake` are filtered out
- unhandled segment types currently render as empty markdown text

## Known limitations / non-goals

- No message editing support.
- `listThreads`, `openModal`, `postEphemeral`, `scheduleMessage` are not implemented.
- Outbound rendering is still text-segment focused (no rich outbound segment builder).

## Test coverage map

- Adapter basics and validation: `test/adapter-basics.test.ts`
- Messaging APIs and history pagination: `test/messaging-apis.test.ts`
- Member/thread query APIs: `test/thread-member-queries.test.ts`
- Message parsing and forward/reply expansion: `test/message-parsing.test.ts`
- Integration event flow: `test/integration-flow.test.ts`
- Heartbeat behavior: `test/heartbeat.test.ts`
- Cache behavior: `test/cached-napcat-client.test.ts`

## Verification commands

- `pnpm --filter chat-adapter-qq test:ci`
- `pnpm --filter chat-adapter-qq typecheck`
