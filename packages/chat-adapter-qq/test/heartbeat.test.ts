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

    await ctx.adapter.shutdown();
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

    await ctx.adapter.shutdown();
  });

  it('stops heartbeat polling after shutdown', async () => {
    vi.useFakeTimers();
    const ctx = await createHeartbeatContext({ intervalMs: 40 });

    await vi.advanceTimersByTimeAsync(40);
    expect(ctx.client.getStatusCalls).toBe(1);

    await ctx.adapter.shutdown();
    expect(ctx.client.disconnectCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.client.getStatusCalls).toBe(1);
  });
});
