import { describe, it, expect } from 'vitest';

import { createQQAdapter } from '../src/index.js';

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
