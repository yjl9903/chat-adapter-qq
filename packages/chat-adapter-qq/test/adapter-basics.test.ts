import { createMemoryState } from '@chat-adapter/state-memory';
import { Chat } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import { createQQAdapter } from '../src/index.js';

import { attachMockClient, MockNapcatClient } from './napcat-mock.js';

async function createInitializedAdapter(options?: {
  logger?: Parameters<typeof createQQAdapter>[0]['logger'];
}) {
  const adapter = createQQAdapter({
    napcat: { baseUrl: 'ws://localhost:3001' },
    logger: options?.logger
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

describe('createQQAdapter', () => {
  it('creates adapter from explicit config', () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    expect(adapter.name).toMatchInlineSnapshot('"qq"');
  });

  it('throws when NapCat config is missing', () => {
    expect(() => createQQAdapter(undefined as never)).toThrowErrorMatchingInlineSnapshot(
      `[ValidationError: QQ NapCat config is required. Pass { napcat: NCWebsocketOptions } to createQQAdapter(config).]`
    );
  });

  it('throws when heartbeat config is invalid', () => {
    expect(() =>
      createQQAdapter({
        napcat: { baseUrl: 'ws://localhost:3001' },
        heartbeat: { intervalMs: 0 }
      })
    ).toThrowErrorMatchingInlineSnapshot(
      `[ValidationError: QQ heartbeat intervalMs must be a positive integer.]`
    );

    expect(() =>
      createQQAdapter({
        napcat: { baseUrl: 'ws://localhost:3001' },
        heartbeat: { failureThreshold: -1 }
      })
    ).toThrowErrorMatchingInlineSnapshot(
      `[ValidationError: QQ heartbeat failureThreshold must be a positive integer.]`
    );
  });
});

describe('QQAdapter thread ID', () => {
  const adapter = createQQAdapter({
    napcat: { baseUrl: 'ws://localhost:3001' }
  });

  it('roundtrips group/private thread IDs', () => {
    const encoded = adapter.encodeThreadId({ chatType: 'group', peerId: '123' });
    const decoded = adapter.decodeThreadId('qq:private:456');

    expect({ encoded, decoded }).toMatchInlineSnapshot(`
      {
        "decoded": {
          "chatType": "private",
          "peerId": "456",
        },
        "encoded": "qq:group:123",
      }
    `);
  });

  it('rejects invalid thread IDs', () => {
    expect(() => adapter.decodeThreadId('invalid')).toThrowErrorMatchingInlineSnapshot(
      `[ValidationError: Invalid QQ thread ID: invalid]`
    );
  });

  it('derives DM and channel ID correctly', () => {
    expect({
      privateIsDm: adapter.isDM('qq:private:1'),
      groupIsDm: adapter.isDM('qq:group:1'),
      channelId: adapter.channelIdFromThreadId('qq:group:1')
    }).toMatchInlineSnapshot(`
      {
        "channelId": "qq:group:1",
        "groupIsDm": false,
        "privateIsDm": true,
      }
    `);
  });
});

describe('QQAdapter event hooks', () => {
  it('bridges socket lifecycle events and supports unsubscribe/off', async () => {
    const { adapter, client } = await createInitializedAdapter();
    const received: string[] = [];

    const unsubscribeConnecting = adapter.on('socket.connecting', (event) => {
      received.push(`${event.type}:${event.reconnection.nowAttempts}`);
    });
    const onConnect = vi.fn((event: { type: string }) => {
      received.push(event.type);
    });

    adapter.on('socket.open', onConnect);

    client.emitSocketConnecting({
      reconnection: {
        enable: true,
        attempts: 3,
        delay: 500,
        nowAttempts: 2
      }
    });
    client.emitSocketOpen({
      reconnection: {
        enable: true,
        attempts: 3,
        delay: 500,
        nowAttempts: 2
      }
    });

    unsubscribeConnecting();
    adapter.off('socket.open', onConnect);

    client.emitSocketConnecting();
    client.emitSocketOpen();

    await vi.waitFor(() => {
      expect(received).toEqual(['socket.connecting:2', 'socket.open']);
    });
    expect(received).toEqual(['socket.connecting:2', 'socket.open']);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('bridges disconnect/error payloads', async () => {
    const { adapter, client } = await createInitializedAdapter();
    let disconnectEvent: { type: string; code: number; reason: string } | null = null;
    let errorEvent: { type: string; errorType: string } | null = null;

    adapter.on('socket.close', (event) => {
      disconnectEvent = { type: event.type, code: event.code, reason: event.reason };
    });
    adapter.on('socket.error', (event) => {
      errorEvent = { type: event.type, errorType: event.error.error_type };
    });

    client.emitSocketClose({
      code: 4000,
      reason: 'server close',
      reconnection: {
        enable: true,
        attempts: 3,
        delay: 500,
        nowAttempts: 2
      }
    });
    client.emitSocketError({
      reconnection: {
        enable: true,
        attempts: 3,
        delay: 500,
        nowAttempts: 2
      },
      error_type: 'connect_error',
      errors: [null]
    });

    await vi.waitFor(() => {
      expect(disconnectEvent).not.toBeNull();
      expect(errorEvent).not.toBeNull();
    });
    expect(disconnectEvent).toEqual({
      type: 'socket.close',
      code: 4000,
      reason: 'server close'
    });
    expect(errorEvent).toEqual({
      type: 'socket.error',
      errorType: 'connect_error'
    });
  });

  it('logs hook errors and continues notifying later listeners', async () => {
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    logger.child.mockReturnValue(logger);

    const { adapter, client } = await createInitializedAdapter({ logger: logger as never });
    const received: string[] = [];

    adapter.on('socket.open', () => {
      throw new Error('boom');
    });
    adapter.on('socket.open', () => {
      received.push('after-error');
    });

    client.emitSocketOpen();

    await vi.waitFor(() => {
      expect(received).toEqual(['after-error']);
    });
    expect(received).toEqual(['after-error']);
    expect(logger.error).toHaveBeenCalledWith(
      'qq adapter event hook failed',
      expect.objectContaining({
        event: 'socket.open',
        error: expect.any(Error)
      })
    );
  });

  it('logs async hook rejections and continues notifying later listeners', async () => {
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    logger.child.mockReturnValue(logger);

    const { adapter, client } = await createInitializedAdapter({ logger: logger as never });
    const received: string[] = [];

    adapter.on('socket.open', async () => {
      throw new Error('async boom');
    });
    adapter.on('socket.open', () => {
      received.push('after-error');
    });

    client.emitSocketOpen();
    await vi.waitFor(() => {
      expect(received).toEqual(['after-error']);
      expect(logger.error).toHaveBeenCalled();
    });

    expect(received).toEqual(['after-error']);
    expect(logger.error).toHaveBeenCalledWith(
      'qq adapter event hook failed',
      expect.objectContaining({
        event: 'socket.open',
        error: expect.any(Error)
      })
    );
  });

  it('snapshots mutable reconnection state before emitting socket events', async () => {
    const { adapter, client } = await createInitializedAdapter();
    const reconnection = {
      enable: true,
      attempts: 3,
      delay: 500,
      nowAttempts: 2
    };
    const snapshots: number[] = [];
    let socketErrorEvent:
      | {
          reconnectionAttempts: number;
          nestedReconnectionAttempts: number;
        }
      | undefined;

    adapter.on('socket.open', (event) => {
      snapshots.push(event.reconnection.nowAttempts);
    });
    adapter.on('socket.error', (event) => {
      socketErrorEvent = {
        reconnectionAttempts: event.reconnection.nowAttempts,
        nestedReconnectionAttempts: event.error.reconnection.nowAttempts
      };
    });

    client.emitSocketOpen({ reconnection });
    reconnection.nowAttempts = 7;
    client.emitSocketError({
      reconnection,
      error_type: 'connect_error',
      errors: [null]
    });

    await vi.waitFor(() => {
      expect(socketErrorEvent).toBeDefined();
    });

    expect(snapshots).toEqual([2]);
    expect(socketErrorEvent).toEqual({
      reconnectionAttempts: 7,
      nestedReconnectionAttempts: 7
    });

    reconnection.nowAttempts = 9;

    expect(snapshots).toEqual([2]);
    expect(socketErrorEvent).toEqual({
      reconnectionAttempts: 7,
      nestedReconnectionAttempts: 7
    });
  });
});
