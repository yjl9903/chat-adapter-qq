import 'dotenv/config';
import fs from 'node:fs';

import { Chat } from 'chat';
import { createMemoryState } from '@chat-adapter/state-memory';

import { createQQAdapter } from '../packages/chat-adapter-qq/src/index.js';

const bot = new Chat({
  userName: '',
  logger: 'debug',
  adapters: {
    qq: createQQAdapter({
      napcat: {
        protocol: 'wss',
        host: process.env.NAPCAT_HOST!,
        port: 443,
        accessToken: process.env.NAPCAT_ACCESS_TOKEN,
        // ↓ 自动重连(可选)
        reconnection: {
          enable: true,
          attempts: 10,
          delay: 5000
        }
      }
    })
  },
  state: createMemoryState()
});

await bot.initialize();

const adapter = bot.getAdapter('qq');
const resp1 = await adapter.fetchMessages(process.env.NAPCAT_PRIVATE_THREAD_ID!, { limit: 5 });

console.log('nextCursor', resp1.nextCursor, resp1.messages.length);
await fs.promises.writeFile(
  '.profile/history.json',
  JSON.stringify(
    resp1.messages.map((m) => m.raw),
    null,
    2
  ),
  'utf-8'
);

if (resp1.nextCursor) {
  const resp2 = await adapter.fetchMessages(process.env.NAPCAT_PRIVATE_THREAD_ID!, {
    limit: 5,
    cursor: resp1.nextCursor
  });
  console.log('nextCursor', resp2.nextCursor, resp2.messages.length);
  await fs.promises.writeFile(
    '.profile/history.json',
    JSON.stringify(
      [...resp2.messages, ...resp1.messages].map((m) => m.raw),
      null,
      2
    ),
    'utf-8'
  );
}

await bot.shutdown();
await bot.getAdapter('qq').shutdown();
