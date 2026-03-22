import { describe, expect, it } from 'vitest';

import { createQQAdapter } from '../src/index.js';

import { attachMockClient, MockNapcatClient } from './napcat-mock.js';

describe('QQAdapter media refresh', () => {
  function createAdapter() {
    const adapter = createQQAdapter({
      napcat: { baseUrl: 'ws://localhost:3001' }
    });
    const client = new MockNapcatClient();
    attachMockClient(adapter, client);
    return { adapter, client };
  }

  it('refreshes image URLs through get_image', async () => {
    const { adapter, client } = createAdapter();
    client.setImageResult('cache/image-key', {
      file: '/tmp/photo.png',
      url: 'https://example.com/image/new',
      file_name: 'photo.png',
      file_size: '123'
    });

    const refreshed = await adapter.refreshAttachment({
      type: 'image',
      name: 'photo.png',
      qq: {
        kind: 'image',
        file: 'cache/image-key'
      }
    });

    expect(client.getImageCalls).toEqual(['cache/image-key']);
    expect(refreshed).toEqual({
      type: 'image',
      name: 'photo.png',
      url: 'https://example.com/image/new',
      size: 123,
      qq: {
        kind: 'image',
        file: 'cache/image-key'
      },
      data: undefined
    });
  });

  it('refreshes file URLs through get_file and prefers fileId', async () => {
    const { adapter, client } = createAdapter();
    client.setFileResult('qq-file-id', {
      file: '/tmp/report.pdf',
      url: 'https://example.com/file/new',
      file_name: 'report.pdf',
      file_size: '456'
    });

    const refreshed = await adapter.refreshAttachment({
      type: 'file',
      name: 'report.pdf',
      qq: {
        kind: 'file',
        file: 'docs/report.pdf',
        fileId: 'qq-file-id'
      }
    });

    expect(client.getFileCalls).toEqual(['qq-file-id']);
    expect(refreshed).toEqual({
      type: 'file',
      name: 'report.pdf',
      url: 'https://example.com/file/new',
      size: 456,
      qq: {
        kind: 'file',
        file: 'docs/report.pdf',
        fileId: 'qq-file-id'
      },
      data: undefined
    });
  });

  it('refreshes video attachments through get_file', async () => {
    const { adapter, client } = createAdapter();
    client.setFileResult('media/clip.mp4', {
      file: '/tmp/clip.mp4',
      url: 'https://example.com/file/video',
      file_name: 'clip.mp4',
      file_size: '789'
    });

    const refreshed = await adapter.refreshAttachment({
      type: 'video',
      name: 'clip.mp4',
      qq: {
        kind: 'video',
        file: 'media/clip.mp4'
      }
    });

    expect(client.getFileCalls).toEqual(['media/clip.mp4']);
    expect(refreshed).toEqual({
      type: 'video',
      name: 'clip.mp4',
      url: 'https://example.com/file/video',
      size: 789,
      qq: {
        kind: 'video',
        file: 'media/clip.mp4'
      },
      data: undefined
    });
  });

  it('refreshes record attachments through get_record', async () => {
    const { adapter, client } = createAdapter();
    client.setRecordResult('media/voice.amr', {
      file: '/tmp/voice.amr',
      url: 'https://example.com/record/audio',
      file_name: 'voice.amr',
      file_size: '321'
    });

    const refreshed = await adapter.refreshAttachment({
      type: 'audio',
      name: 'voice.amr',
      qq: {
        kind: 'record',
        file: 'media/voice.amr'
      }
    });

    expect(client.getRecordCalls).toEqual(['media/voice.amr']);
    expect(refreshed).toEqual({
      type: 'audio',
      name: 'voice.amr',
      url: 'https://example.com/record/audio',
      size: 321,
      qq: {
        kind: 'record',
        file: 'media/voice.amr'
      },
      data: undefined
    });
  });

  it('refreshes attachments using embedded qq metadata', async () => {
    const { adapter, client } = createAdapter();
    client.setFileResult('qq-file-id', {
      file: '/tmp/report.pdf',
      url: 'https://example.com/file/new'
    });

    const refreshed = await adapter.refreshAttachment({
      type: 'file',
      name: 'report.pdf',
      qq: {
        kind: 'file',
        file: 'docs/report.pdf',
        fileId: 'qq-file-id'
      }
    });

    expect(refreshed.url).toBe('https://example.com/file/new');
  });

  it('accepts raw file strings when kind is provided', async () => {
    const { adapter, client } = createAdapter();
    client.setFileResult('qq-file-id', {
      file: '/tmp/report.pdf',
      url: 'https://example.com/file/new'
    });

    const refreshed = await adapter.refreshAttachment('qq-file-id', 'file');

    expect(client.getFileCalls).toEqual(['qq-file-id']);
    expect(refreshed.url).toBe('https://example.com/file/new');
  });
});
