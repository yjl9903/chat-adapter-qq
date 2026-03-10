import { describe, it, expect } from 'vitest';
import { createMemoryState } from '@chat-adapter/state-memory';
import { type Message, type Thread, Chat, NotImplementedError } from 'chat';

import { createQQAdapter, type QQGroupMessage, type QQPrivateMessage } from '../src/index.js';

import { attachMockClient, createGroupMessage, MockNapcatClient } from './napcat-mock.js';

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Condition not met within timeout');
}

async function createQQTestContext(handlers?: {
  onMention?: (thread: Thread, message: Message) => void | Promise<void>;
  onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
}) {
  const client = new MockNapcatClient();
  const adapter = createQQAdapter({
    napcat: { baseUrl: 'ws://localhost:3001' }
  });
  attachMockClient(adapter, client);

  const chat = new Chat({
    userName: 'qq-bot',
    adapters: { qq: adapter },
    state: createMemoryState(),
    logger: 'error'
  });

  const captured: {
    mentionMessage: Message | null;
    followUpMessage: Message | null;
  } = {
    mentionMessage: null,
    followUpMessage: null
  };

  if (handlers?.onMention) {
    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message;
      await handlers.onMention!(thread, message);
    });
  }

  if (handlers?.onSubscribed) {
    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpMessage = message;
      await handlers.onSubscribed!(thread, message);
    });
  }

  await chat.initialize();

  return {
    client,
    adapter,
    chat,
    captured,
    sendGroup: async (event: QQGroupMessage) => {
      client.emitGroup(event);
      await flush();
    },
    sendPrivate: async (event: QQPrivateMessage) => {
      client.emitPrivate(event);
      await flush();
    }
  };
}

describe('createQQAdapter', () => {
  it('creates adapter from explicit config', () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    expect(adapter.name).toBe('qq');
  });

  it('throws when NapCat config is missing', () => {
    expect(() => createQQAdapter(undefined as never)).toThrow('NapCat config is required');
  });
});

describe('QQAdapter thread ID', () => {
  const adapter = createQQAdapter({
    napcat: { baseUrl: 'ws://localhost:3001' }
  });

  it('roundtrips group/private thread IDs', () => {
    expect(adapter.encodeThreadId({ chatType: 'group', peerId: '123' })).toBe('qq:group:123');
    expect(adapter.decodeThreadId('qq:private:456')).toEqual({
      chatType: 'private',
      peerId: '456'
    });
  });

  it('rejects invalid thread IDs', () => {
    expect(() => adapter.decodeThreadId('invalid')).toThrow('Invalid QQ thread ID');
  });

  it('derives DM and channel ID correctly', () => {
    expect(adapter.isDM('qq:private:1')).toBe(true);
    expect(adapter.isDM('qq:group:1')).toBe(false);
    expect(adapter.channelIdFromThreadId('qq:group:1')).toBe('qq:group:1');
  });
});

describe('QQAdapter parseMessage', () => {
  it('parses group message text and attachments', () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    const raw = createGroupMessage([
      { type: 'text', data: { text: 'hello ' } },
      { type: 'at', data: { qq: '10001' } },
      {
        type: 'image',
        data: {
          summary: 'img',
          file: 'img.png',
          sub_type: 0,
          url: 'https://example.com/img.png',
          file_size: '1'
        }
      }
    ]);

    const message = adapter.parseMessage(raw);

    expect(message.threadId).toBe('qq:group:30003');
    expect(message.text).toContain('hello');
    expect(message.text).toContain('@10001');
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.type).toBe('image');
  });
});

describe('QQ adapter integration', () => {
  it('handles mention -> subscribe -> follow-up flow', async () => {
    const ctx = await createQQTestContext({
      onMention: async (thread) => {
        await thread.subscribe();
        await thread.post('Got it');
      },
      onSubscribed: async (thread, message) => {
        await thread.post(`Echo: ${message.text}`);
      }
    });

    await ctx.sendGroup(
      createGroupMessage(
        [
          { type: 'text', data: { text: 'hi ' } },
          { type: 'at', data: { qq: '10001' } }
        ],
        { messageId: 123 }
      )
    );
    await waitFor(() => ctx.captured.mentionMessage !== null);

    await ctx.sendGroup(
      createGroupMessage([{ type: 'text', data: { text: 'follow up' } }], { messageId: 124 })
    );
    await waitFor(() => ctx.captured.followUpMessage !== null);

    expect(ctx.captured.mentionMessage?.text).toContain('hi');
    expect(ctx.captured.followUpMessage?.text).toContain('follow up');
    expect(ctx.client.sentGroupMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('filters self messages from entering handler flow', async () => {
    let mentionCount = 0;
    const ctx = await createQQTestContext({
      onMention: async () => {
        mentionCount += 1;
      }
    });

    await ctx.sendGroup(
      createGroupMessage(
        [
          { type: 'text', data: { text: 'self ' } },
          { type: 'at', data: { qq: '10001' } }
        ],
        { userId: 10001 }
      )
    );

    await flush();
    expect(mentionCount).toBe(0);
  });
});

describe('QQ adapter methods', () => {
  it('routes group/private post and delete APIs', async () => {
    const ctx = await createQQTestContext();

    await ctx.adapter.postMessage('qq:group:30003', { markdown: 'hello **qq**' });
    await ctx.adapter.postMessage('qq:private:20002', 'private hi');
    await ctx.adapter.deleteMessage('qq:group:30003', '42');

    expect(ctx.client.sentGroupMessages).toHaveLength(1);
    expect(ctx.client.sentPrivateMessages).toHaveLength(1);
    expect(ctx.client.sentGroupMessages[0]?.group_id).toBe(30003);
    expect(ctx.client.sentPrivateMessages[0]?.user_id).toBe(20002);
    expect(ctx.client.deletedMessages).toEqual([42]);
  });

  it('returns 501 from handleWebhook in WS-only mode', async () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    const response = await adapter.handleWebhook(new Request('https://example.com/webhook'));
    expect(response.status).toBe(501);
  });

  it('throws NotImplementedError for deferred APIs', async () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    await expect(adapter.editMessage('qq:group:1', '1', 'x')).rejects.toBeInstanceOf(
      NotImplementedError
    );
    await expect(adapter.addReaction('qq:group:1', '1', '👍')).rejects.toBeInstanceOf(
      NotImplementedError
    );
    await expect(adapter.removeReaction('qq:group:1', '1', '👍')).rejects.toBeInstanceOf(
      NotImplementedError
    );
    await expect(adapter.fetchMessages('qq:group:1')).rejects.toBeInstanceOf(NotImplementedError);
  });
});
