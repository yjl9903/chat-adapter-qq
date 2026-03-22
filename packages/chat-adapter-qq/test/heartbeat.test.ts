import { createMemoryState } from '@chat-adapter/state-memory';
import { Chat } from 'chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQQAdapter } from '../src/index.js';

import { attachMockClient, MockNapcatClient } from './napcat-mock.js';

async function createHeartbeatContext(options?: {
  intervalMs?: number;
  failureThreshold?: number;
  reconnectOnFailure?: boolean;
}) {
  const adapter = createQQAdapter({
    napcat: { baseUrl: 'ws://localhost:3001' },
    heartbeat: {
      intervalMs: options?.intervalMs ?? 100,
      failureThreshold: options?.failureThreshold ?? 2,
      reconnectOnFailure: options?.reconnectOnFailure ?? true
    }
  });
  const client = new MockNapcatClient();
  attachMockClient(adapter, client);

  const chat = new Chat({
    userName: 'qq-bot',
    adapters: { qq: adapter },
    state: createMemoryState(),
    logger: 'error'
  });

  await chat.initialize();

  return { adapter, client };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('QQ adapter heartbeat', () => {
  it('polls NapCat get_status by interval', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({ intervalMs: 100 });

    expect(ctx.client.getStatusCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.client.getStatusCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(ctx.client.getStatusCalls).toBe(4);

    await ctx.adapter.disconnect();
  });

  it('reconnects when heartbeat status is unhealthy', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({
      intervalMs: 50,
      failureThreshold: 1
    });
    ctx.client.setStatusQueue([{ online: false, good: false, stat: {} }]);

    await vi.advanceTimersByTimeAsync(50);

    expect({
      statusChecks: ctx.client.getStatusCalls,
      reconnectCalls: ctx.client.reconnectCalls
    }).toMatchInlineSnapshot(`
      {
        "reconnectCalls": 1,
        "statusChecks": 1,
      }
    `);

    await ctx.adapter.disconnect();
  });

  it('emits heartbeat failure/reconnecting events across threshold crossing', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({
      intervalMs: 50,
      failureThreshold: 2
    });
    const failures: Array<{ failures: number; willReconnect: boolean }> = [];
    const reconnecting: number[] = [];
    const sequence: string[] = [];
    const reconnected: number[] = [];

    ctx.adapter.on('heartbeat.failure', (event) => {
      failures.push({
        failures: event.failures,
        willReconnect: event.willReconnect
      });
    });
    ctx.adapter.on('heartbeat.reconnecting', (event) => {
      reconnecting.push(event.failures);
      sequence.push(event.type);
    });
    ctx.adapter.on('socket.open', () => {
      sequence.push('socket.open');
    });
    ctx.adapter.on('heartbeat.reconnected', (event) => {
      reconnected.push(event.failures);
      sequence.push(event.type);
    });

    ctx.client.setStatusQueue([
      { online: false, good: false, stat: {} },
      { online: false, good: false, stat: {} }
    ]);

    await vi.advanceTimersByTimeAsync(100);

    expect(failures).toEqual([
      { failures: 1, willReconnect: false },
      { failures: 2, willReconnect: true }
    ]);
    expect(reconnecting).toEqual([2]);
    expect(reconnected).toEqual([2]);
    expect(sequence).toEqual(['heartbeat.reconnecting', 'socket.open', 'heartbeat.reconnected']);

    await ctx.adapter.disconnect();
  });

  it('emits heartbeat failure without reconnecting when status request throws and reconnect is disabled', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({
      intervalMs: 50,
      reconnectOnFailure: false
    });
    const failures: Array<{ error: unknown; willReconnect: boolean; failures: number }> = [];
    const reconnecting = vi.fn();
    const reconnected = vi.fn();

    ctx.adapter.on('heartbeat.failure', (event) => {
      failures.push({
        error: event.error,
        willReconnect: event.willReconnect,
        failures: event.failures
      });
    });
    ctx.adapter.on('heartbeat.reconnecting', reconnecting);
    ctx.adapter.on('heartbeat.reconnected', reconnected);

    ctx.client.setStatusQueue([new Error('status failed')]);

    await vi.advanceTimersByTimeAsync(50);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.failures).toBe(1);
    expect(failures[0]?.willReconnect).toBe(false);
    expect(failures[0]?.error).toBeInstanceOf(Error);
    expect(ctx.client.reconnectCalls).toBe(0);
    expect(reconnecting).not.toHaveBeenCalled();
    expect(reconnected).not.toHaveBeenCalled();

    await ctx.adapter.disconnect();
  });

  it('does not reconnect after a heartbeat.failure hook disconnects the adapter', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({
      intervalMs: 50,
      failureThreshold: 1
    });

    ctx.adapter.on('heartbeat.failure', () => {
      void ctx.adapter.disconnect();
    });

    ctx.client.setStatusQueue([{ online: false, good: false, stat: {} }]);

    await vi.advanceTimersByTimeAsync(50);

    expect(ctx.client.reconnectCalls).toBe(0);
    expect(ctx.client.disconnectCalls).toBe(1);
  });

  it('waits for async heartbeat.failure hooks before deciding to reconnect', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({
      intervalMs: 50,
      failureThreshold: 1
    });

    ctx.adapter.on('heartbeat.failure', async () => {
      await Promise.resolve();
      await ctx.adapter.disconnect();
    });

    ctx.client.setStatusQueue([{ online: false, good: false, stat: {} }]);

    await vi.advanceTimersByTimeAsync(50);

    expect(ctx.client.reconnectCalls).toBe(0);
    expect(ctx.client.disconnectCalls).toBe(1);
  });

  it('does not reconnect after a heartbeat.reconnecting hook disconnects the adapter', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({
      intervalMs: 50,
      failureThreshold: 1
    });

    ctx.adapter.on('heartbeat.reconnecting', () => {
      void ctx.adapter.disconnect();
    });

    ctx.client.setStatusQueue([{ online: false, good: false, stat: {} }]);

    await vi.advanceTimersByTimeAsync(50);

    expect(ctx.client.reconnectCalls).toBe(0);
    expect(ctx.client.disconnectCalls).toBe(1);
  });

  it('waits for async heartbeat.reconnecting hooks before reconnecting', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({
      intervalMs: 50,
      failureThreshold: 1
    });

    ctx.adapter.on('heartbeat.reconnecting', async () => {
      await Promise.resolve();
      await ctx.adapter.disconnect();
    });

    ctx.client.setStatusQueue([{ online: false, good: false, stat: {} }]);

    await vi.advanceTimersByTimeAsync(50);

    expect(ctx.client.reconnectCalls).toBe(0);
    expect(ctx.client.disconnectCalls).toBe(1);
  });

  it('stops heartbeat polling after disconnect', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({ intervalMs: 40 });

    await vi.advanceTimersByTimeAsync(40);
    expect(ctx.client.getStatusCalls).toBe(1);

    await ctx.adapter.disconnect();
    expect(ctx.client.disconnectCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.client.getStatusCalls).toBe(1);
  });
});
