# chat-adapter-qq - 2026-03-10

## Reference Docs

- Adapter build reference: https://chat-sdk.dev/docs/contributing/building
- Supplementary testing guide used for test structure alignment: https://chat-sdk.dev/docs/contributing/testing

## Context

This package is a Chat SDK community adapter for QQ, implemented on top of `node-napcat-ts`.

The current package code is still in bootstrap state. This document captures the agreed MVP direction and serves as the implementation baseline for the next commits.

## MVP Goals

1. Bridge NapCat incoming events to Chat SDK handler flow.
2. Support core message delivery in QQ group and private chat.
3. Keep API surface aligned with Chat SDK adapter conventions.
4. Document unsupported capabilities explicitly for MVP.

## Decisions (Locked)

1. Ingress mode: NapCat WebSocket only (no HTTP webhook mode in MVP).
2. Config style: explicit config only (no environment-variable fallback in factory).
3. Thread model: conversation-as-thread.
4. Mention semantics:
   - Group: mention only when message segments contain `at self_id`.
   - Private: all incoming private messages are treated as mentions.
5. Scope: core message flow MVP first; advanced capabilities can follow in later iterations.

## Adapter Design Baseline

### Public API

- `QQAdapter` class
- `createQQAdapter(config)` factory
- `QQAdapterConfig` exported type
- `QQThreadId` exported type

### Thread ID Mapping

- Group: `qq:group:<group_id>`
- Private: `qq:private:<user_id>`
- `channelIdFromThreadId(threadId)` returns the same value as `threadId` in MVP.

### Core Runtime Flow

1. `initialize(chat)` creates and connects `NCWebsocket`.
2. Register listeners for `message.group` and `message.private.*`.
3. Convert NapCat payload into Chat SDK `Message`.
4. Dispatch through `chat.processMessage(...)`.
5. `postMessage(...)` routes to `send_group_msg` / `send_private_msg`.

## MVP Capability Matrix

- Supported:
  - Incoming messages (group/private)
  - Mention detection (as defined above)
  - Outgoing message posting
  - Message delete (via NapCat `delete_msg`)
- Limited or deferred:
  - Message edit
  - Reaction add/remove
  - Full history fetching and pagination
  - Advanced rich formatting conversion

## Test Targets

1. Factory config validation.
2. Thread ID encode/decode roundtrip and invalid format handling.
3. Mention detection for group/private paths.
4. Event bridging from NapCat WS to Chat SDK processing.
5. Post routing to group/private send APIs.
6. Self-message loop prevention.

## Next Step

Implement adapter files and tests based on this baseline, then update `README.md` to match actual exported API and setup steps.
