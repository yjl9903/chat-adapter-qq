import { describe, it, expect } from 'vitest';
import { stringifyMarkdown } from 'chat';

import { createQQAdapter } from '../src/index.js';

import { createGroupMessage } from './napcat-mock.js';
import { createQQTestContext } from './test-context.js';

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

    expect({
      threadId: message.threadId,
      text: message.text,
      markdown: stringifyMarkdown(message.formatted),
      attachments: message.attachments
    }).toMatchInlineSnapshot(`
      {
        "attachments": [
          {
            "name": "img.png",
            "size": 1,
            "type": "image",
            "url": "https://example.com/img.png",
          },
        ],
        "markdown": "hello @10001
      ![img.png](https://example.com/img.png)
      ",
        "text": "hello @10001
      img.png",
        "threadId": "qq:group:30003",
      }
    `);
  });

  it('renders placeholders and filters unsupported segments', () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    const raw = createGroupMessage([
      { type: 'text', data: { text: 'hello ' } },
      { type: 'reply', data: { id: '5566' } },
      { type: 'forward', data: { id: 'fw-7788' } },
      { type: 'file', data: { file: 'report.pdf', file_id: 'file-id', file_size: '256' } },
      {
        type: 'video',
        data: {
          file: 'clip.mp4',
          url: 'https://example.com/clip.mp4',
          file_size: '128'
        }
      },
      { type: 'record', data: { file: 'voice.amr', file_size: '64' } },
      { type: 'dice', data: { result: '6' } },
      { type: 'poke', data: { type: 'touch', id: '1' } },
      { type: 'rps', data: { result: '2' } }
    ]);

    const message = adapter.parseMessage(raw);

    expect({
      text: message.text,
      markdown: stringifyMarkdown(message.formatted),
      attachmentTypes: message.attachments.map((item) => item.type)
    }).toMatchInlineSnapshot(`
      {
        "attachmentTypes": [
          "file",
          "video",
          "audio",
        ],
        "markdown": "hello

      > 回复消息 #5566

      > 转发消息 #fw-7788

      附件:report.pdf

      [clip.mp4](https://example.com/clip.mp4)

      音频:voice.amr
      ",
        "text": "hello
      回复消息 #5566
      转发消息 #fw-7788
      附件:report.pdf
      clip.mp4
      音频:voice.amr",
      }
    `);
  });

  it('falls back to labels when url is unavailable', () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    const raw = createGroupMessage([
      {
        type: 'image',
        data: {
          summary: 'img',
          file: 'folder/photo.jpg',
          sub_type: 0,
          url: '',
          file_size: '1024'
        }
      },
      { type: 'file', data: { file: '/tmp/archive.zip', file_id: '2', file_size: '9' } }
    ]);

    const message = adapter.parseMessage(raw);

    expect({
      text: message.text,
      markdown: stringifyMarkdown(message.formatted),
      attachmentTypes: message.attachments.map((item) => item.type)
    }).toMatchInlineSnapshot(`
      {
        "attachmentTypes": [
          "image",
          "file",
        ],
        "markdown": "图片:photo.jpg

      附件:archive.zip
      ",
        "text": "图片:photo.jpg
      附件:archive.zip",
      }
    `);
  });

  it('does not fallback to raw_message when all segments are filtered', () => {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });

    const raw = createGroupMessage(
      [
        { type: 'rps', data: { result: '1' } },
        { type: 'poke', data: { type: 'shake', id: '2' } }
      ],
      { rawMessage: '[CQ:poke]' }
    );

    const message = adapter.parseMessage(raw);
    expect(message.text).toMatchInlineSnapshot('""');
  });

  it('resolves reply placeholder to quoted author + multiline body in async parse path', async () => {
    const ctx = await createQQTestContext();

    ctx.client.setMessage(
      createGroupMessage([{ type: 'text', data: { text: 'quoted line 1\n\nquoted line 2' } }], {
        messageId: 900,
        userId: 20002
      })
    );

    const incoming = createGroupMessage(
      [
        { type: 'reply', data: { id: '900' } },
        { type: 'text', data: { text: ' tail' } }
      ],
      { messageId: 901, userId: 20003 }
    );

    const message = await ctx.adapter.parseThreadMessage(incoming);

    expect({
      text: message.text,
      markdown: stringifyMarkdown(message.formatted)
    }).toMatchInlineSnapshot(`
      {
        "markdown": "> alice (qq 20002):
      > quoted line 1
      >
      > quoted line 2

      tail
      ",
        "text": "alice (qq 20002):
      quoted line 1
      quoted line 2
      tail",
      }
    `);
  });

  it('keeps non-leading reply as placeholder without calling get_msg', async () => {
    const ctx = await createQQTestContext();

    const incoming = createGroupMessage(
      [
        { type: 'text', data: { text: 'prefix ' } },
        { type: 'reply', data: { id: '930' } },
        { type: 'text', data: { text: 'suffix' } }
      ],
      { messageId: 931, userId: 20003 }
    );

    const message = await ctx.adapter.parseThreadMessage(incoming);

    expect({
      getMsgCalls: ctx.client.getMsgCalls,
      text: message.text,
      markdown: stringifyMarkdown(message.formatted)
    }).toMatchInlineSnapshot(`
      {
        "getMsgCalls": [],
        "markdown": "prefix

      > 回复消息 #930

      suffix
      ",
        "text": "prefix
      回复消息 #930
      suffix",
      }
    `);
  });

  it('resolves standalone forward message via get_msg in async parse path', async () => {
    const ctx = await createQQTestContext();

    const forwardA = createGroupMessage(
      [{ type: 'text', data: { text: 'fwd line 1\n\nfwd line 2' } }],
      {
        messageId: 910,
        userId: 20002
      }
    );
    const forwardB = createGroupMessage(
      [
        {
          type: 'image',
          data: {
            summary: 'img',
            file: 'fwd.png',
            sub_type: 0,
            url: 'https://example.com/fwd.png',
            file_size: '7'
          }
        }
      ],
      {
        messageId: 911,
        userId: 20004
      }
    );
    forwardB.sender.card = 'bob-card';

    ctx.client.setMessage(
      createGroupMessage(
        [
          {
            type: 'forward',
            data: {
              id: 'fw-900',
              content: [forwardA, forwardB]
            }
          }
        ] as any,
        {
          messageId: 920,
          userId: 20002
        }
      )
    );

    const incoming = createGroupMessage([{ type: 'forward', data: { id: 'fw-900' } }], {
      messageId: 920,
      userId: 20003
    });

    const message = await ctx.adapter.parseThreadMessage(incoming);

    expect({
      getMsgCalls: ctx.client.getMsgCalls,
      getForwardMsgCalls: ctx.client.getForwardMsgCalls,
      text: message.text,
      markdown: stringifyMarkdown(message.formatted)
    }).toMatchInlineSnapshot(`
      {
        "getForwardMsgCalls": [],
        "getMsgCalls": [
          920,
        ],
        "markdown": "> alice (qq 20002):
      > fwd line 1
      >
      > fwd line 2

      > bob-card (qq 20004):
      > ![fwd.png](https://example.com/fwd.png)
      ",
        "text": "alice (qq 20002):
      fwd line 1
      fwd line 2
      bob-card (qq 20004):
      fwd.png",
      }
    `);
  });

  it('uses expanded nested forward content from get_msg', async () => {
    const ctx = await createQQTestContext();

    const level1Text = createGroupMessage([{ type: 'text', data: { text: 'level-1' } }], {
      messageId: 941,
      userId: 21001
    });
    const level2Text = createGroupMessage([{ type: 'text', data: { text: 'level-2' } }], {
      messageId: 943,
      userId: 22001
    });
    const level3Text = createGroupMessage([{ type: 'text', data: { text: 'level-3' } }], {
      messageId: 945,
      userId: 23001
    });
    const level4Text = createGroupMessage([{ type: 'text', data: { text: 'level-4' } }], {
      messageId: 947,
      userId: 24001
    });

    const level3Nested = createGroupMessage(
      [
        {
          type: 'forward',
          data: {
            id: 'fw-l4',
            content: [level4Text]
          }
        }
      ] as any,
      {
        messageId: 946,
        userId: 23002
      }
    );
    const level2Nested = createGroupMessage(
      [
        {
          type: 'forward',
          data: {
            id: 'fw-l3',
            content: [level3Text, level3Nested]
          }
        }
      ] as any,
      {
        messageId: 944,
        userId: 22002
      }
    );
    const level1Nested = createGroupMessage(
      [
        {
          type: 'forward',
          data: {
            id: 'fw-l2',
            content: [level2Text, level2Nested]
          }
        }
      ] as any,
      {
        messageId: 942,
        userId: 21002
      }
    );

    ctx.client.setMessage(
      createGroupMessage(
        [
          {
            type: 'forward',
            data: {
              id: 'fw-l1',
              content: [level1Text, level1Nested]
            }
          }
        ] as any,
        {
          messageId: 948,
          userId: 20003
        }
      )
    );

    const incoming = createGroupMessage([{ type: 'forward', data: { id: 'fw-l1' } }], {
      messageId: 948,
      userId: 20003
    });

    const message = await ctx.adapter.parseThreadMessage(incoming);

    expect({
      getMsgCalls: ctx.client.getMsgCalls,
      getForwardMsgCalls: ctx.client.getForwardMsgCalls,
      markdown: stringifyMarkdown(message.formatted)
    }).toMatchInlineSnapshot(`
      {
        "getForwardMsgCalls": [],
        "getMsgCalls": [
          948,
        ],
        "markdown": "> alice (qq 21001):
      > level-1

      > alice (qq 21002):
      >
      > > alice (qq 22001):
      > > level-2
      >
      > > alice (qq 22002):
      > >
      > > > alice (qq 23001):
      > > > level-3
      > >
      > > > alice (qq 23002):
      > > >
      > > > > alice (qq 24001):
      > > > > level-4
      ",
      }
    `);
  });
});
