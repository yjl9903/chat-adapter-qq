import { describe, it, expect } from 'vitest';

import { createGroupMemberInfo, createGroupMessage } from './napcat-mock.js';
import { createQQTestContext, flush, waitFor } from './test-context.js';

describe('QQ adapter integration flow', () => {
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

    ctx.client.setGroupMembers(30003, [
      createGroupMemberInfo({
        groupId: 30003,
        userId: 10001,
        nickname: 'qq-bot',
        isRobot: true
      }),
      createGroupMemberInfo({
        groupId: 30003,
        userId: 20002,
        nickname: 'alice'
      })
    ]);

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

    expect({
      mentionText: ctx.captured.mentionMessage?.text,
      followUpText: ctx.captured.followUpMessage?.text,
      sentGroupCount: ctx.client.sentGroupMessages.length
    }).toMatchInlineSnapshot(`
      {
        "followUpText": "follow up",
        "mentionText": "hi @qq-bot{qq:10001}",
        "sentGroupCount": 2,
      }
    `);
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
    expect(mentionCount).toMatchInlineSnapshot('0');
  });

  it('serializes rapid subscribed messages in the same thread', async () => {
    const started: string[] = [];
    const finished: string[] = [];

    let releaseFirstMessage!: () => void;
    const firstMessageGate = new Promise<void>((resolve) => {
      releaseFirstMessage = resolve;
    });

    const ctx = await createQQTestContext({
      onMention: async (thread) => {
        await thread.subscribe();
      },
      onSubscribed: async (_thread, message) => {
        started.push(message.id);

        if (message.id === '124') {
          await firstMessageGate;
        }

        finished.push(message.id);
      }
    });

    ctx.client.setGroupMembers(30003, [
      createGroupMemberInfo({
        groupId: 30003,
        userId: 10001,
        nickname: 'qq-bot',
        isRobot: true
      }),
      createGroupMemberInfo({
        groupId: 30003,
        userId: 20002,
        nickname: 'alice'
      })
    ]);

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

    ctx.client.emitGroup(
      createGroupMessage([{ type: 'text', data: { text: 'first' } }], { messageId: 124 })
    );
    ctx.client.emitGroup(
      createGroupMessage([{ type: 'text', data: { text: 'second' } }], { messageId: 125 })
    );

    await flush();

    expect(started).toEqual(['124']);
    expect(finished).toEqual([]);

    releaseFirstMessage();

    await waitFor(() => finished.length === 2);

    expect({
      started,
      finished
    }).toMatchInlineSnapshot(`
      {
        "finished": [
          "124",
          "125",
        ],
        "started": [
          "124",
          "125",
        ],
      }
    `);
  });
});
