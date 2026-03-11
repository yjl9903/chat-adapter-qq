import { describe, it, expect } from 'vitest';

import { createGroupMessage } from './napcat-mock.js';
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
        "mentionText": "hi @10001",
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
});
