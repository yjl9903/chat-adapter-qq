# qq adapter member queries - 2026-03-11

Status: `current`

## Scope

This document describes QQ-specific member query APIs implemented by `QQAdapter`.

For full adapter status, see `docs/2026-03-12-qq-adapter-current-status.md`.

## API surface

Added without changing Chat SDK core adapter contract:

- `fetchThreadMembers(threadId: string): Promise<QQMemberProfile[]>`
- `fetchThreadMember(threadId: string, userId: string): Promise<QQMemberProfile | null>`
- `fetchChannelMembers(channelId: string): Promise<QQMemberProfile[]>`
- `fetchChannelMember(channelId: string, userId: string): Promise<QQMemberProfile | null>`

Channel methods delegate to thread methods (QQ uses conversation-as-thread/channel).

## Unified member shape

Defined in `packages/chat-adapter-qq/src/types.ts`:

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

`QQMemberRaw` union:

- `QQGroupMemberInfo`
- `QQLoginInfo`
- `QQFriendInfo`
- `QQStrangerInfo`

## Data source mapping

### Group thread

- list: `get_group_member_list({ group_id })`
- single: `get_group_member_info({ group_id, user_id })`

Mapping:

- `userId <- user_id`
- `userName <- nickname`
- `cardName <- card`
- `isBot <- is_robot`
- `isMe <- String(user_id) === selfId`

### Private thread

Private chat has no native member list API, so adapter builds `self + peer`:

- self: `get_login_info()`
- peer resolution order:
  1. `get_friend_list()` by `user_id`
  2. fallback `get_stranger_info({ user_id })`

Private single-member query returns only `self` or `peer`; unrelated `userId` returns `null`.

## Related implementation

- adapter methods: `packages/chat-adapter-qq/src/adapter.ts`
- mapping helpers: `packages/chat-adapter-qq/src/utils.ts`

## Tests

- `packages/chat-adapter-qq/test/thread-member-queries.test.ts`
  - group list + single profile mapping
  - private friend-first resolution
  - private stranger fallback
  - channel-wrapper behavior
