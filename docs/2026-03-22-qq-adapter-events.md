# qq adapter events - 2026-03-22

Status: `current`

## Scope

This document describes adapter-level event hooks exposed by `packages/chat-adapter-qq`.

## Reference

- adapter runtime: `packages/chat-adapter-qq/src/adapter.ts`
- event emitter: `packages/chat-adapter-qq/src/event-emitter.ts`
- heartbeat manager: `packages/chat-adapter-qq/src/napcat/heartbeat.ts`
- public types: `packages/chat-adapter-qq/src/types.ts`
- tests: `packages/chat-adapter-qq/test/adapter-basics.test.ts`
- tests: `packages/chat-adapter-qq/test/heartbeat.test.ts`

## Public API

Use adapter instance methods:

- `adapter.on(event, handler)`
- `adapter.off(event, handler)`

`on()` returns an unsubscribe function.

## Event names

Socket bridge events:

- `socket.connecting`
- `socket.open`
- `socket.close`
- `socket.error`

Heartbeat bridge events:

- `heartbeat.failure`
- `heartbeat.reconnecting`
- `heartbeat.reconnected`

## Mapping

- `socket.connecting` -> `socket.connecting`
- `socket.open` -> `socket.open`
- `socket.close` -> `socket.close`
- `socket.error` -> `socket.error`

Heartbeat manager emits:

- `heartbeat.failure` on status request errors or unhealthy `get_status()` responses
- `heartbeat.reconnecting` immediately before heartbeat-driven reconnect starts
- `heartbeat.reconnected` after the heartbeat reconnect callback finishes successfully

Heartbeat-driven reconnect success is observable from both `socket.open` and `heartbeat.reconnected`.

## Handler behavior

- handlers run in registration order
- handler errors are caught and logged
- one failing handler does not block later handlers for the same event
