import { describe, it, expect, vi } from 'vitest';
import type { AdapterPostableMessage, Logger } from 'chat';

import { QQFormatConverter } from '../src/converter/index.js';
import { at, forward, reply } from '../src/converter/ast.js';
import { formatQQMentionToken } from '../src/converter/mention.js';
import type { QQOutgoingRenderOptions } from '../src/converter/outgoing.js';

function createLogger(): Logger {
  return {
    child: () => createLogger(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function converter(logger?: Logger) {
  const instance = new QQFormatConverter(undefined, logger);
  return {
    toAst: instance.toAst.bind(instance),
    renderOutgoing: (
      message: AdapterPostableMessage,
      options: QQOutgoingRenderOptions = { chatType: 'group', peerId: '30003' }
    ) => instance.renderOutgoing(message, options)
  };
}

describe('QQFormatConverter.renderOutgoing', () => {
  // -- text-only messages --

  it('renders a plain string as a text segment', async () => {
    const segments = await converter().renderOutgoing('hello');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: 'text', data: { text: 'hello' } });
  });

  it('uses a space fallback for empty text-only messages', async () => {
    const segments = await converter().renderOutgoing({ markdown: '' });
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: 'text', data: { text: ' ' } });
  });

  it('keeps raw text-only messages as a single text segment', async () => {
    const segments = await converter().renderOutgoing({ raw: 'hello' });
    expect(Array.from(segments)).toEqual([{ type: 'text', data: { text: 'hello' } }]);
  });

  it('renders CardElement as text', async () => {
    const card: AdapterPostableMessage = { type: 'card', title: 'Title', children: [] };
    const segments = await converter().renderOutgoing(card);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0].type).toBe('text');
  });

  it('renders explicit at AST nodes inside a paragraph as at segments', async () => {
    const segments = await converter().renderOutgoing({
      ast: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'hello ' },
              at('10001'),
              { type: 'text', value: ' world' }
            ]
          }
        ]
      }
    });

    expect(Array.from(segments)).toEqual([
      { type: 'text', data: { text: 'hello ' } },
      { type: 'at', data: { qq: '10001' } },
      { type: 'text', data: { text: ' world' } }
    ]);
  });

  it('renders explicit top-level at AST nodes as at segments', async () => {
    const segments = await converter().renderOutgoing({
      ast: { type: 'root', children: [at('10001')] }
    });

    expect(Array.from(segments)).toEqual([{ type: 'at', data: { qq: '10001' } }]);
  });

  it('renders explicit at AST nodes as plain text in private chats', async () => {
    const segments = await converter().renderOutgoing(
      {
        ast: { type: 'root', children: [at('10001')] }
      },
      { chatType: 'private', peerId: '20002' }
    );

    expect(Array.from(segments)).toEqual([{ type: 'text', data: { text: '@10001' } }]);
  });

  it('prefers explicit at node labels in private chats', async () => {
    const segments = await converter().renderOutgoing(
      {
        ast: { type: 'root', children: [at('10001', 'qq-bot')] }
      },
      { chatType: 'private', peerId: '20002' }
    );

    expect(Array.from(segments)).toEqual([{ type: 'text', data: { text: '@qq-bot' } }]);
  });

  it('parses @name{qq:id} mention tokens inside markdown text', async () => {
    const segments = await converter().renderOutgoing({
      markdown: 'hello @qq-bot{qq:10001} world'
    });

    expect(Array.from(segments)).toEqual([
      { type: 'text', data: { text: 'hello ' } },
      { type: 'at', data: { qq: '10001' } },
      { type: 'text', data: { text: ' world' } }
    ]);
  });

  it('parses formatter output for digit-prefixed display names', async () => {
    const segments = await converter().renderOutgoing({
      markdown: `hello ${formatQQMentionToken('20005', '123bot')} world`
    });

    expect(Array.from(segments)).toEqual([
      { type: 'text', data: { text: 'hello ' } },
      { type: 'at', data: { qq: '20005' } },
      { type: 'text', data: { text: ' world' } }
    ]);
  });

  it('parses formatter output for display names containing separator-prefixed @', async () => {
    const segments = await converter().renderOutgoing({
      markdown: `hello ${formatQQMentionToken('20005', 'foo @bar')} world`
    });

    expect(Array.from(segments)).toEqual([
      { type: 'text', data: { text: 'hello ' } },
      { type: 'at', data: { qq: '20005' } },
      { type: 'text', data: { text: ' world' } }
    ]);
  });

  it('keeps named mention tokens as plain text in private chats', async () => {
    const segments = await converter().renderOutgoing(
      {
        markdown: `hello ${formatQQMentionToken('20005', 'foo @bar')} world`
      },
      { chatType: 'private', peerId: '20005' }
    );

    expect(Array.from(segments)).toEqual([
      { type: 'text', data: { text: 'hello @foo @bar world' } }
    ]);
  });

  it('keeps a leading reply as the first segment without adding a newline before the body', async () => {
    const body = converter().toAst('hello');
    const segments = await converter().renderOutgoing({
      ast: { type: 'root', children: [reply('42'), body.children[0]] }
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ type: 'reply', data: { id: '42' } });
    expect(segments[1]).toEqual({ type: 'text', data: { text: 'hello' } });
  });

  it('supports reply metadata on PostableMarkdown', async () => {
    const segments = await converter().renderOutgoing({
      markdown: 'hello',
      reply: '42'
    });

    expect(Array.from(segments)).toEqual([
      { type: 'reply', data: { id: '42' } },
      { type: 'text', data: { text: 'hello' } }
    ]);
  });

  it('supports reply metadata on PostableCard', async () => {
    const segments = await converter().renderOutgoing({
      card: { type: 'card', title: 'Title', children: [] },
      reply: '42'
    });

    expect(segments[0]).toMatchObject({ type: 'reply', data: { id: '42' } });
    expect(segments[1]).toEqual({ type: 'text', data: { text: 'Title' } });
  });

  it('ignores reply nodes that are not the first root node', async () => {
    const body = converter().toAst('before\n\nafter');
    const segments = await converter().renderOutgoing({
      ast: { type: 'root', children: [body.children[0], reply('42'), body.children[1]] }
    });

    expect(Array.from(segments)).toEqual([{ type: 'text', data: { text: 'before\nafter' } }]);
  });

  it('renders a forward node only when it is the sole root node', async () => {
    const segments = await converter().renderOutgoing({
      ast: { type: 'root', children: [forward('123')] }
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: 'forward', data: { id: '123' } });
  });

  it('records multi-message forward batches on the returned builder', async () => {
    const outgoing = await converter().renderOutgoing({
      ast: { type: 'root', children: [forward('123', '456')] }
    });

    expect(outgoing.getForwardMessageIds()).toEqual(['123', '456']);
    expect(Array.from(outgoing)).toEqual([]);
    expect(outgoing.toForwardNodeSegments()).toEqual([
      { type: 'node', data: { id: '123' } },
      { type: 'node', data: { id: '456' } }
    ]);
  });

  it('supports forward metadata on PostableAst', async () => {
    const outgoing = await converter().renderOutgoing({
      ast: { type: 'root', children: [] },
      forward: ['123', '456']
    });

    expect(outgoing.getForwardMessageIds()).toEqual(['123', '456']);
    expect(Array.from(outgoing)).toEqual([]);
  });

  it('ignores forward nodes when other root nodes are present', async () => {
    const body = converter().toAst('hello');
    const segments = await converter().renderOutgoing({
      ast: { type: 'root', children: [forward('123'), body.children[0]] }
    });

    expect(Array.from(segments)).toEqual([{ type: 'text', data: { text: 'hello' } }]);
  });

  // -- media extraction from message variants --

  it('extracts files from PostableMarkdown', async () => {
    const segments = await converter().renderOutgoing({
      markdown: 'look',
      files: [{ data: Buffer.from('img'), filename: 'photo.png', mimeType: 'image/png' }]
    });
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe('text');
    expect(segments[1].type).toBe('image');
  });

  it('extracts attachments from PostableRaw', async () => {
    const segments = await converter().renderOutgoing({
      raw: 'see',
      attachments: [{ type: 'image', url: 'https://example.com/img.jpg', name: 'img.jpg' }]
    });
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe('text');
    expect(segments[1].type).toBe('image');
    expect(segments[1].data.file).toBe('https://example.com/img.jpg');
  });

  it('extracts files from PostableCard', async () => {
    const segments = await converter().renderOutgoing({
      card: { type: 'card', title: 'T', children: [] },
      files: [{ data: Buffer.from('d'), filename: 'doc.pdf', mimeType: 'application/pdf' }]
    });
    const fileSegments = segments.filter((s) => s.type === 'file');
    expect(fileSegments).toHaveLength(1);
  });

  it('extracts both files and attachments from PostableAst', async () => {
    const segments = await converter().renderOutgoing({
      ast: { type: 'root', children: [] },
      files: [{ data: Buffer.from('a'), filename: 'a.png', mimeType: 'image/png' }],
      attachments: [{ type: 'file', name: 'b.pdf', url: 'https://example.com/b.pdf' }]
    });
    const imageSegs = segments.filter((s) => s.type === 'image');
    const fileSegs = segments.filter((s) => s.type === 'file');
    expect(imageSegs).toHaveLength(1);
    expect(fileSegs).toHaveLength(1);
  });

  it('skips empty text when media is present', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      attachments: [{ type: 'image', url: 'https://example.com/x.jpg', name: 'x.jpg' }]
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('image');
  });

  // -- MIME / extension type mapping --

  it('maps image MIME to image segment', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      files: [{ data: Buffer.from('x'), filename: 'f', mimeType: 'image/png' }]
    });
    expect(segments[0].type).toBe('image');
  });

  it('maps video MIME to video segment', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      files: [{ data: Buffer.from('x'), filename: 'f', mimeType: 'video/mp4' }]
    });
    expect(segments[0].type).toBe('video');
  });

  it('maps audio MIME to record segment', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      files: [{ data: Buffer.from('x'), filename: 'f', mimeType: 'audio/ogg' }]
    });
    expect(segments[0].type).toBe('record');
  });

  it('falls back to file segment for unknown MIME', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      files: [{ data: Buffer.from('x'), filename: 'f', mimeType: 'application/pdf' }]
    });
    expect(segments[0].type).toBe('file');
  });

  it('guesses image from filename extension when no MIME', async () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']) {
      const segments = await converter().renderOutgoing({
        markdown: '',
        files: [{ data: Buffer.from('x'), filename: `photo.${ext}` }]
      });
      expect(segments[0].type).toBe('image');
    }
  });

  it('guesses video from filename extension when no MIME', async () => {
    for (const ext of ['mp4', 'webm', 'avi', 'mov', 'mkv']) {
      const segments = await converter().renderOutgoing({
        markdown: '',
        files: [{ data: Buffer.from('x'), filename: `clip.${ext}` }]
      });
      expect(segments[0].type).toBe('video');
    }
  });

  it('guesses audio from filename extension when no MIME', async () => {
    for (const ext of ['mp3', 'ogg', 'wav', 'flac', 'aac', 'opus']) {
      const segments = await converter().renderOutgoing({
        markdown: '',
        files: [{ data: Buffer.from('x'), filename: `track.${ext}` }]
      });
      expect(segments[0].type).toBe('record');
    }
  });

  it('falls back to file when extension is unknown and no MIME', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      files: [{ data: Buffer.from('x'), filename: 'data.xyz' }]
    });
    expect(segments[0].type).toBe('file');
  });

  it('prefers MIME over filename extension', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      files: [{ data: Buffer.from('x'), filename: 'photo.png', mimeType: 'video/mp4' }]
    });
    expect(segments[0].type).toBe('video');
  });

  // -- attachment data resolution --

  it('resolves Attachment with fetchData', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      attachments: [{ type: 'image', name: 'f.png', fetchData: async () => Buffer.from('fetched') }]
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('image');
    expect(segments[0].data.file).toBe(`base64://${Buffer.from('fetched').toString('base64')}`);
  });

  it('resolves Attachment with Buffer data', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      attachments: [{ type: 'video', name: 'v.mp4', data: Buffer.from('vid') }]
    });
    expect(segments[0].type).toBe('video');
    expect(segments[0].data.file).toBe(`base64://${Buffer.from('vid').toString('base64')}`);
  });

  it('uses Attachment.type directly (file stays file even with audio MIME)', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '',
      attachments: [
        { type: 'file', name: 'song.mp3', mimeType: 'audio/mp3', url: 'https://example.com/s' }
      ]
    });
    expect(segments[0].type).toBe('file');
  });

  it('resolves ArrayBuffer FileUpload data', async () => {
    const ab = new ArrayBuffer(4);
    new Uint8Array(ab).set([1, 2, 3, 4]);
    const segments = await converter().renderOutgoing({
      markdown: '',
      files: [{ data: ab, filename: 'data.bin', mimeType: 'application/octet-stream' }]
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('file');
  });

  // -- error resilience --

  it('skips Attachment when fetchData throws', async () => {
    const logger = createLogger();
    const segments = await converter(logger).renderOutgoing({
      markdown: '',
      attachments: [
        {
          type: 'image',
          name: 'broken.png',
          fetchData: async () => {
            throw new Error('network error');
          }
        }
      ]
    });
    // falls back to space text since no media resolved
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('text');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips Attachment with no data, fetchData, or url', async () => {
    const logger = createLogger();
    const segments = await converter(logger).renderOutgoing({
      markdown: '',
      attachments: [{ type: 'image', name: 'empty.png' }]
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('text');
    expect(logger.warn).toHaveBeenCalled();
  });

  // -- markdown image extraction --

  it('extracts inline images from markdown body as image segments', async () => {
    const segments = await converter().renderOutgoing({
      markdown: 'Hello ![photo](https://example.com/img.png) world'
    });
    const textSeg = segments.find((s) => s.type === 'text');
    const imageSeg = segments.find((s) => s.type === 'image');
    expect(textSeg).toBeDefined();
    expect(textSeg!.data.text).not.toContain('example.com/img.png');
    expect(imageSeg).toBeDefined();
    expect(imageSeg!.data.file).toBe('https://example.com/img.png');
  });

  it('extracts multiple images from markdown', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '![a](https://example.com/a.png)\n\n![b](https://example.com/b.png)'
    });
    const imageSegs = segments.filter((s) => s.type === 'image');
    expect(imageSegs).toHaveLength(2);
    expect(imageSegs[0].data.file).toBe('https://example.com/a.png');
    expect(imageSegs[1].data.file).toBe('https://example.com/b.png');
  });

  it('keeps non-HTTP images as text', async () => {
    const segments = await converter().renderOutgoing({
      markdown: 'Hello ![local](file:///tmp/img.png) world'
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('text');
    expect(segments[0].data.text).toContain('local');
  });

  it('combines extracted images with explicit file uploads', async () => {
    const segments = await converter().renderOutgoing({
      markdown: 'See ![pic](https://example.com/pic.jpg)',
      files: [{ data: Buffer.from('img'), filename: 'extra.png', mimeType: 'image/png' }]
    });
    const imageSegs = segments.filter((s) => s.type === 'image');
    expect(imageSegs).toHaveLength(2);
  });

  it('returns only image segments when markdown is image-only', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '![pic](https://example.com/pic.jpg)'
    });
    // text should be empty/trimmed, so no text segment — only image
    const imageSegs = segments.filter((s) => s.type === 'image');
    expect(imageSegs).toHaveLength(1);
    expect(imageSegs[0].data.file).toBe('https://example.com/pic.jpg');
  });

  it('keeps labeled link destinations when flattening markdown to text', async () => {
    const segments = await converter().renderOutgoing({
      markdown: '[docs](https://example.com)'
    });

    expect(Array.from(segments)).toEqual([
      { type: 'text', data: { text: 'docs (https://example.com)' } }
    ]);
  });
});
