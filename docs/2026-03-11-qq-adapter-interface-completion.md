# qq adapter interface completion - 2026-03-11

## Reference

- `chat` adapter contract: `node_modules/chat/dist/index.d.ts`
- Community adapter guide: `node_modules/chat/docs/contributing/building.mdx`
- NapCat SDK API: `node_modules/node-napcat-ts/dist/NCWebsocketApi.d.ts`
- NapCat request/response types: `node_modules/node-napcat-ts/dist/Interfaces.d.ts`
- Implementation: `packages/chat-adapter-qq/src/adapter.ts`
- Cached client: `packages/chat-adapter-qq/src/napcat/cached-client.ts`
- Runtime example: `examples/history.ts`

## Status

This document now reflects **implemented behavior** (not pending design) for the QQ adapter interface completion.

Implemented in this round:

1. `editMessage`: explicitly unsupported.
2. `addReaction` / `removeReaction`: implemented via NapCat emoji-like APIs.
3. `fetchMessages`: implemented with pagination.
4. `fetchThread`: implemented with API-backed full metadata.
5. `startTyping`: implemented via input-status API.
6. Add useful optional Chat APIs with clear behavior.
7. QQ custom member query APIs for thread/channel.
8. Query cache layer with memoized NapCat read APIs.

## Adapter Coverage (Implemented)

Required methods:

- `editMessage`: throws explicit `NotImplementedError`.
- `addReaction` / `removeReaction`: call `set_msg_emoji_like`.
- `fetchMessages`: support both `direction: backward | forward`.
- `fetchThread`: call platform APIs instead of returning decode-only metadata.
- `startTyping`: private chat calls API; group chat no-op with debug log.

Optional methods added:

- `fetchMessage(threadId, messageId)` -> `get_msg` + thread consistency check.
- `openDM(userId)` -> return encoded `qq:private:{userId}`.
- `fetchChannelInfo(channelId)` and `fetchChannelMessages(channelId, options)` -> delegate to thread-level methods (QQ uses conversation-as-thread model).
- Reaction ingress support: listens `notice.group_msg_emoji_like` and emits Chat SDK reaction events via `chat.processReaction(...)`.

QQ custom extension methods added:

- `fetchThreadMembers(threadId)`
- `fetchThreadMember(threadId, userId)`
- `fetchChannelMembers(channelId)`
- `fetchChannelMember(channelId, userId)`

## Chat-to-NapCat Mapping

- Reaction add:
  - `set_msg_emoji_like({ message_id, emoji_id, set: true })`
- Reaction remove:
  - `set_msg_emoji_like({ message_id, emoji_id, set: false })`
- Fetch group history:
  - `get_group_msg_history({ group_id, message_seq?, count?, reverseOrder? })`
- Fetch private history:
  - `get_friend_msg_history({ user_id, message_seq?, count?, reverseOrder? })`
- Fetch thread metadata:
  - group: `get_group_info({ group_id })`
  - private: `get_friend_list()` match first, fallback `get_stranger_info({ user_id })`
- Typing:
  - `set_input_status({ user_id: String(peerId), event_type: 1 })` (private only)

## Query Cache Layer

- Adapter now instantiates `CachedNCWebsocket` by default.
- `createAsyncMemoFactory(...)` wraps read APIs with LRU memoization.
- Cached methods:
  - `get_login_info`
  - `get_friend_list`
  - `get_stranger_info`
  - `get_group_info`
  - `get_group_member_info`
  - `get_group_member_list`
- Cache invalidation is hooked to write APIs:
  - `set_friend_remark`
  - `set_group_card`
  - `set_group_name`
  - `set_group_leave`
  - `set_group_kick`

## Pagination + Ordering Rules

- Cursor format: use `message_seq` string.
- `limit` maps to NapCat `count`; if cursor exists, request `count = limit + 1`.
- `direction` mapping:
  - `backward` -> `reverseOrder: true`
  - `forward` -> `reverseOrder: false`
- When cursor is present, remove the echoed cursor item (`message_seq === cursor`) before returning.
- `nextCursor`:
  - `backward`: use current page first item's `message_seq`
  - `forward`: use current page last item's `message_seq`
- Current implementation relies on NapCat response ordering and does not locally re-sort messages.

## Emoji Normalization Note

- Emoji normalization logic has been extracted to `packages/chat-adapter-qq/src/emoji.ts`.
- A TODO is intentionally kept there: current behavior is passthrough (`string` or `EmojiValue.name`), and exact mapping to NapCat `emoji_id` still needs formal confirmation for all emoji forms.

## Test Checklist

Automated verification:

- `pnpm --filter chat-adapter-qq test`
- `pnpm --filter chat-adapter-qq typecheck`

Covered scenarios in `packages/chat-adapter-qq/test/index.test.ts`:

- edit unsupported behavior.
- reaction API mapping (`set_msg_emoji_like`).
- `fetchMessages` group/private routing, direction, cursor pagination, and `nextCursor`.
- thread metadata fetch for group/private.
- private thread metadata source priority (`friend_list` first, fallback `stranger_info`).
- typing behavior (private call / group no-op).
- optional APIs: `fetchMessage`, `openDM`, `fetchChannelInfo`, `fetchChannelMessages`.
- custom member query APIs: thread/channel list + single member.

Covered scenarios in `packages/chat-adapter-qq/test/cached-napcat-client.test.ts`:

- memo cache hit behavior.
- in-flight request deduplication.
- ttl refresh behavior.
- explicit invalidate.

Manual runtime verification:

- Ran `examples/history.ts` against live NapCat to validate cursor flow (`nextCursor` progression and page fetch behavior).

## Out of Scope

- `listThreads` (QQ conversation model does not expose multi-thread listing in one channel)
- `openModal`, `postEphemeral`, `scheduleMessage`
