# qq adapter heartbeat - 2026-03-12

## Reference

- Adapter implementation: `packages/chat-adapter-qq/src/adapter.ts`
- Heartbeat manager: `packages/chat-adapter-qq/src/heartbeat.ts`
- Config types: `packages/chat-adapter-qq/src/types.ts`
- Factory validation: `packages/chat-adapter-qq/src/factory.ts`
- Heartbeat tests: `packages/chat-adapter-qq/test/heartbeat.test.ts`
- NapCat SDK API typings: `node_modules/node-napcat-ts/dist/NCWebsocketApi.d.ts`

## Background

This iteration adds heartbeat to QQ adapter, using NapCat status polling to detect WS connection health and trigger recovery when needed.

- `QQNapcatConnectionHeartbeat` in `src/heartbeat.ts`

## API Selection

Heartbeat polling uses NapCat `get_status()` as the health probe.

- healthy condition: `status.online === true && status.good === true`
- unhealthy condition: request failure, or `online/good` check fails

No HTTP health endpoint is used in adapter runtime. WS-side API polling remains the single heartbeat path.

## Architecture

### QQAdapter responsibilities

`QQAdapter` now:

1. Creates/holds `QQNapcatConnectionHeartbeat`.
2. Starts heartbeat after successful login in `initialize`.
3. Stops heartbeat in `shutdown`.
4. Provides reconnect callback (`reconnectClient`) used by heartbeat manager.

### Heartbeat class responsibilities

`QQNapcatConnectionHeartbeat` manages:

1. Polling schedule via `setInterval`.
2. In-flight deduplication (at most one heartbeat check at a time).
3. Consecutive failure counting.
4. Threshold-based reconnect trigger.
5. Recovery-state guard to prevent concurrent reconnect attempts.

## Lifecycle

1. Adapter initializes and connects NapCat.
2. Adapter fetches login info and sets `selfId/userName`.
3. Adapter starts heartbeat manager.
4. Manager polls `get_status()` periodically.
5. On consecutive failures reaching threshold, manager calls reconnect callback.
6. Adapter reconnect callback refreshes login state after reconnect.
7. Adapter shutdown stops heartbeat manager and disconnects client.

## Config and Defaults

Heartbeat is forcibly enabled once adapter initialization succeeds.

Optional tuning remains:

- `heartbeat.intervalMs` (default: `30000`)
- `heartbeat.failureThreshold` (default: `2`)
- `heartbeat.reconnectOnFailure` (default: `true`)

Factory-level validation:

- `intervalMs` must be a positive integer
- `failureThreshold` must be a positive integer

## Failure Strategy

For each poll:

1. If `get_status()` throws, count as one failure.
2. If `online/good` is unhealthy, count as one failure.
3. If failure count >= threshold and reconnect is enabled, attempt reconnect.
4. On successful reconnect, reset failure counter.
5. If reconnect fails, keep manager running and continue next polling cycle.

## Testing Checklist

Covered by `test/heartbeat.test.ts`:

1. Polling runs at configured interval (`get_status` call count assertion).
2. Unhealthy heartbeat triggers reconnect when threshold is reached.
3. Shutdown stops polling and prevents further status checks.

Recommended regression checks:

- `pnpm --filter chat-adapter-qq test:ci`
- `pnpm --filter chat-adapter-qq typecheck`
