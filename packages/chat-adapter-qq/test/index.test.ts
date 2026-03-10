import { describe, it, expect } from 'vitest';
import { createMemoryState } from '@chat-adapter/state-memory';
import { type EmojiValue, type Message, type Thread, Chat, NotImplementedError } from 'chat';

import { createQQAdapter, type QQGroupMessage, type QQPrivateMessage } from '../src/index.js';

import {
  attachMockClient,
  createGroupMessage,
  createPrivateMessage,
  MockNapcatClient
} from './napcat-mock.js';

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

  it('keeps editMessage explicitly unsupported', async () => {
    const ctx = await createQQTestContext();
    await expect(ctx.adapter.editMessage('qq:group:1', '1', 'x')).rejects.toBeInstanceOf(
      NotImplementedError
    );
  });

  it('maps reactions to emoji_like APIs', async () => {
    const ctx = await createQQTestContext();
    const emojiValue = { name: '128077' } as unknown as EmojiValue;

    await ctx.adapter.addReaction('qq:group:30003', '42', emojiValue);
    await ctx.adapter.removeReaction('qq:group:30003', '42', '128077');

    expect(ctx.client.emojiLikeCalls).toEqual([
      { message_id: 42, emoji_id: '128077', set: true },
      { message_id: 42, emoji_id: '128077', set: false }
    ]);
  });

  it('fetches group/private histories with pagination and direction', async () => {
    const ctx = await createQQTestContext();
    const groupMessages = [
      createGroupMessage([{ type: 'text', data: { text: 'm1' } }], {
        groupId: 30003,
        messageId: 101,
        messageSeq: 1,
        time: 1710000001
      }),
      createGroupMessage([{ type: 'text', data: { text: 'm2' } }], {
        groupId: 30003,
        messageId: 102,
        messageSeq: 2,
        time: 1710000002
      }),
      createGroupMessage([{ type: 'text', data: { text: 'm3' } }], {
        groupId: 30003,
        messageId: 103,
        messageSeq: 3,
        time: 1710000003
      }),
      createGroupMessage([{ type: 'text', data: { text: 'm4' } }], {
        groupId: 30003,
        messageId: 104,
        messageSeq: 4,
        time: 1710000004
      }),
      createGroupMessage([{ type: 'text', data: { text: 'm5' } }], {
        groupId: 30003,
        messageId: 105,
        messageSeq: 5,
        time: 1710000005
      })
    ];
    ctx.client.setGroupHistory(30003, groupMessages);
    ctx.client.setFriendHistory(20002, [
      createPrivateMessage([{ type: 'text', data: { text: 'p1' } }], {
        userId: 20002,
        messageId: 201,
        messageSeq: 1
      }),
      createPrivateMessage([{ type: 'text', data: { text: 'p2' } }], {
        userId: 20002,
        messageId: 202,
        messageSeq: 2
      })
    ]);

    const latest = await ctx.adapter.fetchMessages('qq:group:30003', {
      limit: 2,
      direction: 'backward'
    });
    expect(latest.messages.map((item) => item.id)).toEqual(['104', '105']);
    expect(latest.nextCursor).toBe('4');

    const older = await ctx.adapter.fetchMessages('qq:group:30003', {
      limit: 2,
      direction: 'backward',
      cursor: latest.nextCursor
    });
    expect(older.messages.map((item) => item.id)).toEqual(['102', '103']);
    expect(older.nextCursor).toBe('2');

    const forward = await ctx.adapter.fetchMessages('qq:group:30003', {
      limit: 2,
      direction: 'forward'
    });
    expect(forward.messages.map((item) => item.id)).toEqual(['101', '102']);
    expect(forward.nextCursor).toBe('2');

    const privateResult = await ctx.adapter.fetchMessages('qq:private:20002', { limit: 1 });
    expect(privateResult.messages.map((item) => item.id)).toEqual(['202']);

    expect(ctx.client.groupHistoryCalls.length).toBeGreaterThanOrEqual(3);
    expect(ctx.client.friendHistoryCalls.length).toBe(1);
  });

  it('fetches thread metadata from NapCat APIs', async () => {
    const ctx = await createQQTestContext();
    ctx.client.setGroupInfo(30003, {
      group_all_shut: 0,
      group_remark: 'remark',
      group_id: 30003,
      group_name: 'My Group',
      member_count: 233,
      max_member_count: 500
    });
    ctx.client.setStrangerInfo(20002, {
      user_id: 20002,
      nickname: 'alice',
      nick: 'alice',
      remark: 'teammate',
      sex: 'female',
      qid: 'alice_qid',
      qqLevel: 12
    });

    const groupThread = await ctx.adapter.fetchThread('qq:group:30003');
    expect(groupThread.channelName).toBe('My Group');
    expect(groupThread.isDM).toBe(false);
    expect(groupThread.metadata.group).toMatchObject({
      group_id: 30003,
      group_name: 'My Group',
      member_count: 233
    });

    const privateThread = await ctx.adapter.fetchThread('qq:private:20002');
    expect(privateThread.channelName).toBe('teammate');
    expect(privateThread.isDM).toBe(true);
    expect(privateThread.metadata.private).toMatchObject({
      user_id: 20002,
      nickname: 'alice',
      remark: 'teammate'
    });
  });

  it('supports typing for private threads and no-op for group threads', async () => {
    const ctx = await createQQTestContext();

    await ctx.adapter.startTyping('qq:private:20002', 'typing');
    await ctx.adapter.startTyping('qq:group:30003', 'typing');

    expect(ctx.client.inputStatusCalls).toEqual([
      {
        user_id: '20002',
        event_type: 1
      }
    ]);
  });

  it('implements optional fetch/open/channel helpers', async () => {
    const ctx = await createQQTestContext();
    ctx.client.setMessage(
      createGroupMessage([{ type: 'text', data: { text: 'single' } }], {
        groupId: 30003,
        messageId: 700,
        messageSeq: 700
      })
    );
    ctx.client.setMessage(
      createPrivateMessage([{ type: 'text', data: { text: 'private-only' } }], {
        userId: 20002,
        messageId: 701,
        messageSeq: 701
      })
    );
    ctx.client.setGroupInfo(30003, {
      group_all_shut: 0,
      group_remark: '',
      group_id: 30003,
      group_name: 'Channel Group',
      member_count: 10,
      max_member_count: 200
    });
    ctx.client.setGroupHistory(30003, [
      createGroupMessage([{ type: 'text', data: { text: 'channel msg' } }], {
        groupId: 30003,
        messageId: 801,
        messageSeq: 1
      })
    ]);

    const fetched = await ctx.adapter.fetchMessage('qq:group:30003', '700');
    expect(fetched?.id).toBe('700');
    const mismatch = await ctx.adapter.fetchMessage('qq:group:30003', '701');
    expect(mismatch).toBeNull();

    await expect(ctx.adapter.openDM('20002')).resolves.toBe('qq:private:20002');

    const channelInfo = await ctx.adapter.fetchChannelInfo('qq:group:30003');
    expect(channelInfo.name).toBe('Channel Group');
    expect(channelInfo.metadata.group).toMatchObject({
      group_id: 30003,
      group_name: 'Channel Group',
      member_count: 10
    });

    const channelMessages = await ctx.adapter.fetchChannelMessages('qq:group:30003', {
      limit: 1
    });
    expect(channelMessages.messages).toHaveLength(1);
  });
});
