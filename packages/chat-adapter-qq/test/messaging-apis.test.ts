import { describe, it, expect } from 'vitest';
import { type EmojiValue, NotImplementedError, emoji } from 'chat';

import { createQQAdapter } from '../src/index.js';

import { createGroupMessage, createPrivateMessage } from './napcat-mock.js';
import { createQQTestContext } from './test-context.js';

describe('QQ adapter messaging APIs', () => {
  it('routes group/private post and delete APIs', async () => {
    const ctx = await createQQTestContext();

    await ctx.adapter.postMessage('qq:group:30003', { markdown: 'hello **qq**' });
    await ctx.adapter.postMessage('qq:private:20002', 'private hi');
    await ctx.adapter.deleteMessage('qq:group:30003', '42');

    expect({
      group: ctx.client.sentGroupMessages,
      private: ctx.client.sentPrivateMessages,
      deleted: ctx.client.deletedMessages
    }).toMatchInlineSnapshot(`
      {
        "deleted": [
          42,
        ],
        "group": [
          {
            "group_id": 30003,
            "message": [
              {
                "data": {
                  "text": "hello **qq**
      ",
                },
                "type": "text",
              },
            ],
          },
        ],
        "private": [
          {
            "message": [
              {
                "data": {
                  "text": "private hi",
                },
                "type": "text",
              },
            ],
            "user_id": 20002,
          },
        ],
      }
    `);
  });

  it('returns 501 from handleWebhook in WS-only mode', async () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    const response = await adapter.handleWebhook(new Request('https://example.com/webhook'));
    expect(response.status).toMatchInlineSnapshot('501');
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

    expect(ctx.client.emojiLikeCalls).toMatchInlineSnapshot(`
      [
        {
          "emoji_id": "128077",
          "message_id": 42,
          "set": true,
        },
        {
          "emoji_id": "128077",
          "message_id": 42,
          "set": false,
        },
      ]
    `);
  });

  it('fills missing builtin emoji with decimal code points without overriding existing maps', async () => {
    const ctx = await createQQTestContext();

    await ctx.adapter.addReaction('qq:group:30003', '42', emoji.smile);
    await ctx.adapter.addReaction('qq:group:30003', '42', emoji.thumbs_up);
    await ctx.adapter.addReaction('qq:group:30003', '42', emoji.heart);

    expect(ctx.client.emojiLikeCalls).toMatchInlineSnapshot(`
      [
        {
          "emoji_id": "128522",
          "message_id": 42,
          "set": true,
        },
        {
          "emoji_id": "76",
          "message_id": 42,
          "set": true,
        },
        {
          "emoji_id": "66",
          "message_id": 42,
          "set": true,
        },
      ]
    `);
  });

  it('fetches group/private histories with pagination and direction', async () => {
    const ctx = await createQQTestContext();

    ctx.client.setGroupHistory(30003, [
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
    ]);

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
    const older = await ctx.adapter.fetchMessages('qq:group:30003', {
      limit: 2,
      direction: 'backward',
      cursor: latest.nextCursor
    });
    const forward = await ctx.adapter.fetchMessages('qq:group:30003', {
      limit: 2,
      direction: 'forward'
    });
    const privateResult = await ctx.adapter.fetchMessages('qq:private:20002', { limit: 1 });

    expect({
      latest: {
        ids: latest.messages.map((item) => item.id),
        cursor: latest.nextCursor
      },
      older: {
        ids: older.messages.map((item) => item.id),
        cursor: older.nextCursor
      },
      forward: {
        ids: forward.messages.map((item) => item.id),
        cursor: forward.nextCursor
      },
      private: privateResult.messages.map((item) => item.id),
      calls: {
        groupHistoryCalls: ctx.client.groupHistoryCalls.length,
        friendHistoryCalls: ctx.client.friendHistoryCalls.length
      }
    }).toMatchInlineSnapshot(`
      {
        "calls": {
          "friendHistoryCalls": 1,
          "groupHistoryCalls": 3,
        },
        "forward": {
          "cursor": "2",
          "ids": [
            "101",
            "102",
          ],
        },
        "latest": {
          "cursor": "4",
          "ids": [
            "104",
            "105",
          ],
        },
        "older": {
          "cursor": "2",
          "ids": [
            "102",
            "103",
          ],
        },
        "private": [
          "202",
        ],
      }
    `);
  });

  it('supports typing for private threads and no-op for group threads', async () => {
    const ctx = await createQQTestContext();

    await ctx.adapter.startTyping('qq:private:20002', 'typing');
    await ctx.adapter.startTyping('qq:group:30003', 'typing');

    expect(ctx.client.inputStatusCalls).toMatchInlineSnapshot(`
      [
        {
          "event_type": 1,
          "user_id": "20002",
        },
      ]
    `);
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
    const mismatch = await ctx.adapter.fetchMessage('qq:group:30003', '701');
    const openedDm = await ctx.adapter.openDM('20002');
    const channelInfo = await ctx.adapter.fetchChannelInfo('qq:group:30003');
    const channelMessages = await ctx.adapter.fetchChannelMessages('qq:group:30003', {
      limit: 1
    });

    expect({
      fetchedId: fetched?.id,
      mismatch,
      openedDm,
      channelInfo: {
        name: channelInfo.name,
        groupName: (channelInfo.metadata.group as { group_name?: string }).group_name,
        memberCount: (channelInfo.metadata.group as { member_count?: number }).member_count
      },
      channelMessageIds: channelMessages.messages.map((item) => item.id)
    }).toMatchInlineSnapshot(`
      {
        "channelInfo": {
          "groupName": "Channel Group",
          "memberCount": 10,
          "name": "Channel Group",
        },
        "channelMessageIds": [
          "801",
        ],
        "fetchedId": "700",
        "mismatch": null,
        "openedDm": "qq:private:20002",
      }
    `);
  });
});
