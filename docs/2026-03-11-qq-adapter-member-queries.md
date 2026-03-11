# qq adapter member queries - 2026-03-11

## Background

`chat-adapter-qq` already covers core message, thread, channel, and reaction capabilities, and now also provides member query APIs for QQ conversations.

This document records the implemented QQ-specific capabilities:

1. Query member list for a thread/channel
2. Query one member profile for a thread/channel

It also defines one unified member payload for both group and private chats.

## Goals

Add custom member query APIs to the QQ adapter for both group and private conversations:

- Group chat: use NapCat group member APIs directly.
- Private chat: manually assemble data for both self and peer.

Unified member fields:

- `userId`: user ID string
- `userName`: display username
- `cardName`: card name (group `card`, private friend `remark`)
- `isBot`: whether the user is a bot
- `isMe`: whether the user is the current bot account
- `raw`: full raw source payload

## Public API Design

Add QQ-specific methods on `QQAdapter` (without changing Chat SDK core `Adapter` interface):

- `fetchThreadMembers(threadId: string): Promise<QQMemberProfile[]>`
- `fetchThreadMember(threadId: string, userId: string): Promise<QQMemberProfile | null>`
- `fetchChannelMembers(channelId: string): Promise<QQMemberProfile[]>`
- `fetchChannelMember(channelId: string, userId: string): Promise<QQMemberProfile | null>`

Channel methods delegate to thread methods, matching existing conversation-as-thread behavior.

## Type Design

Implemented and exported in `src/types.ts`:

```ts
export interface QQMemberProfile {
  userId: string;
  userName: string;
  cardName: string;
  isBot: boolean;
  isMe: boolean;
  raw: QQMemberRaw;
}
```

`QQMemberRaw` is a union of:
- `QQGroupMemberInfo`
- `QQLoginInfo`
- `QQFriendInfo`
- `QQStrangerInfo`

## NapCat Mapping

### Group Chat

- Member list: `get_group_member_list({ group_id })`
- Single member: `get_group_member_info({ group_id, user_id })`

Field mapping:

- `userId <- user_id`
- `userName <- nickname`
- `cardName <- card`
- `isBot <- is_robot`
- `isMe <- String(user_id) === selfId`
- `raw <- original payload`

### Private Chat

No native "member list" exists for private chat, so build a 2-member list (`self + peer`):

- Self: `get_login_info()` (required)
- Peer lookup order:
  - First: `get_friend_list()` and match `user_id === peerId`
  - Fallback: `get_stranger_info({ user_id: peerId })`
- Card source: prefer friend `remark`; fallback to stranger `remark`

Field mapping:

- `userName`
  - Self: `login.nickname`
  - Peer (friend hit): `friend.nickname || userId`
  - Peer (fallback): `stranger.nickname || stranger.nick || userId`
- `cardName`
  - Self: `''`
  - Peer: `friend.remark || stranger.remark || ''`
- `isMe`
  - Self: `true`
  - Peer: `false`
- `isBot`
  - Self: `true`
  - Peer: `false` when unknown
- `raw`
  - Self: `get_login_info` payload
  - Peer: matched friend entry, or fallback stranger payload

For private chat `fetchThreadMember`, only self and peer are valid candidates; any other `userId` returns `null`.

### Private Thread Metadata Source

For `fetchThread('qq:private:*')`, metadata now includes:
- `source: 'friend_list' | 'stranger_info'`
- `private`: the matched source payload

Resolution order is consistent with member queries:
1. friend list match first
2. fallback to stranger info

## Query Cache Layer

A cached NapCat client is now used by default in the adapter:

- File: `src/napcat/cached-client.ts`
- Class: `CachedNCWebsocket extends NCWebsocket`
- Cache backend: `lru-cache`
- Memo factory: `createAsyncMemoFactory(...)`

Cached query methods:
- `get_login_info`
- `get_friend_list`
- `get_stranger_info`
- `get_group_info`
- `get_group_member_info`
- `get_group_member_list`

Write APIs invalidate related cache keys:
- `set_friend_remark`
- `set_group_card`
- `set_group_name`
- `set_group_leave`
- `set_group_kick`

## Implementation Steps

1. Add `QQMemberProfile` (and related helper type aliases if needed) in `src/types.ts`.
2. Add the four member query methods and private mapping helpers in `src/adapter.ts`.
3. Export `QQMemberProfile` from `src/index.ts`.
4. Extend mocks in `test/napcat-mock.ts`:
   - `get_group_member_list`
   - `get_group_member_info`
   - `get_friend_list`
   - call trackers and fixture setters
5. Add tests for group/private member queries in `test/index.test.ts`.

## Test Checklist

- Group member list query: API routing and field mapping are correct.
- Group single member query: target member resolved with correct `isMe/isBot/cardName`.
- Private member list query: returns exactly two members (`self + peer`).
- Private mapping priority: friend list hit first; fallback to stranger info.
- Private single member query: self/peer available; out-of-conversation user returns `null`.
- Channel wrapper methods: behavior matches thread methods.
- Type exports: `QQMemberProfile` is importable from package entry.

## Non-goals

- No change to Chat SDK core `Adapter` contract.
- No member-list pagination.
- No cross-process/distributed cache in this iteration.
