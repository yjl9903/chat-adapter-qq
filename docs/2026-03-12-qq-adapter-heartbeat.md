# qq adapter heartbeat - 2026-03-12

Status: `current`

## Scope

This document describes heartbeat behavior for QQ adapter NapCat connections.

For full adapter status, see `docs/2026-03-12-qq-adapter-current-status.md`.

## Reference

- adapter runtime: `packages/chat-adapter-qq/src/adapter.ts`
- heartbeat manager: `packages/chat-adapter-qq/src/heartbeat.ts`
- config types: `packages/chat-adapter-qq/src/types.ts`
- factory validation: `packages/chat-adapter-qq/src/factory.ts`
- tests: `packages/chat-adapter-qq/test/heartbeat.test.ts`

## Health probe

Heartbeat uses NapCat `get_status()` only.

Healthy condition:

- `status.online === true`
- `status.good === true`

Unhealthy condition:

- API request throws, or
- any of `online/good` is false

## Lifecycle

1. Adapter initializes and connects NapCat.
2. Adapter fetches login info and sets `selfId/userName`.
3. Adapter starts heartbeat manager.
4. Manager polls `get_status()` by interval.
5. On consecutive failures reaching threshold, manager runs reconnect callback.
6. Adapter reconnect callback refreshes login state.
7. Adapter shutdown stops heartbeat and disconnects client.

## Config and defaults

- `heartbeat.intervalMs` default: `30000`
- `heartbeat.failureThreshold` default: `2`
- `heartbeat.reconnectOnFailure` default: `true`

Validation in factory:

- `intervalMs` must be positive integer
- `failureThreshold` must be positive integer

## Failure/recovery policy

- at most one heartbeat check in-flight at a time
- consecutive failures increment counter
- if `reconnectOnFailure` and counter reaches threshold:
  - trigger reconnect once (guarded by `recovering` flag)
  - reset failure counter on successful reconnect
- reconnect errors are logged; next polling cycle continues

## Tests

`packages/chat-adapter-qq/test/heartbeat.test.ts` covers:

1. interval polling behavior
2. unhealthy status trigger + reconnect
3. no more polling after adapter shutdown

## Verification commands

- `pnpm --filter chat-adapter-qq test:ci`
- `pnpm --filter chat-adapter-qq typecheck`
