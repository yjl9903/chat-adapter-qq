import 'dotenv/config';
import fs from 'node:fs';

import { type Message, Chat } from 'chat';
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

bot.onNewMention(async (thread, message) => {
  bot.getLogger(thread.adapter.name).info('onNewMention', message);
  await thread.subscribe();
  await thread.post(`订阅频道: ${message.text}`);
  await writeMessage(message);
});

bot.onSubscribedMessage(async (thread, message) => {
  bot.getLogger(thread.adapter.name).info('onSubscribedMessage', message);
  await thread.post(`收到消息: ${message.text}`);
  await writeMessage(message);
});

async function writeMessage(message: Message<unknown>) {
  await fs.promises.writeFile(
    `.profile/${message.id}.json`,
    JSON.stringify(message.raw, null, 2),
    'utf-8'
  );
}
