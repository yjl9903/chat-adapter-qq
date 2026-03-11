# qq adapter interface completion - 2026-03-11

Status: `historical`

> This file records the March 11 interface-completion milestone.
> For the latest behavior, see `docs/2026-03-12-qq-adapter-current-status.md`.

## Milestone scope

This phase completed the main Chat adapter interface for QQ on top of NapCat:

1. completed required methods and explicit unsupported behavior
2. completed core optional query APIs
3. added QQ-specific thread/channel member query APIs
4. added query-side cache layer and pagination flow

## Delivered API coverage (at milestone)

Required methods:

- `editMessage`: throws explicit `NotImplementedError`
- `addReaction` / `removeReaction`: mapped to `set_msg_emoji_like`
- `fetchMessages`: backward/forward directions + cursor pagination
- `fetchThread`: API-backed thread metadata (group/private)
- `startTyping`: private call, group no-op

Optional methods:

- `fetchMessage(threadId, messageId)`
- `openDM(userId)`
- `fetchChannelInfo(channelId)`
- `fetchChannelMessages(channelId, options)`

QQ extension methods:

- `fetchThreadMembers(threadId)`
- `fetchThreadMember(threadId, userId)`
- `fetchChannelMembers(channelId)`
- `fetchChannelMember(channelId, userId)`

## API mapping snapshot

- reactions: `set_msg_emoji_like`
- group history: `get_group_msg_history`
- private history: `get_friend_msg_history`
- group metadata: `get_group_info`
- private metadata: `get_friend_list` (preferred), fallback `get_stranger_info`
- typing (private): `set_input_status`

## Pagination rules in this phase

- cursor uses NapCat `message_seq` as string
- `limit` maps to `count`
- with cursor, request `count = limit + 1` and drop echoed cursor item
- direction mapping:
  - `backward` -> `reverseOrder: true`
  - `forward` -> `reverseOrder: false`
- `nextCursor`:
  - backward -> first item `message_seq`
  - forward -> last item `message_seq`

## Cache layer introduced

`CachedNCWebsocket` memoized selected read APIs with TTL and in-flight dedup:

- `get_login_info`
- `get_friend_list`
- `get_stranger_info`
- `get_group_info`
- `get_group_member_info`
- `get_group_member_list`

And invalidated related keys on selected write APIs.

## Tests (milestone)

Coverage later moved from a single test file to split suites:

- `packages/chat-adapter-qq/test/messaging-apis.test.ts`
- `packages/chat-adapter-qq/test/thread-member-queries.test.ts`
- `packages/chat-adapter-qq/test/cached-napcat-client.test.ts`

## Follow-up docs

- Message markdown parsing detail: `docs/2026-03-11-qq-adapter-message-markdown-parsing.md`
- Heartbeat detail: `docs/2026-03-12-qq-adapter-heartbeat.md`
