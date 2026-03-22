import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

import { Chat } from 'chat';

import { createQQAdapter } from '../packages/chat-adapter-qq/src/index.js';
import { createSqliteState } from '../packages/chat-adapter-sqlite/src/index.js';

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
  state: createSqliteState({ path: 'chat.sqlite' })
});

await bot.initialize();

const adapter = bot.getAdapter('qq');

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`订阅频道: ${message.text}`);
});

bot.onSubscribedMessage(async (thread, message) => {
  console.log('Receive message attachments', message.attachments);
  for (const attachment of message.attachments) {
    const resp = await bot.getAdapter('qq').refreshAttachment(attachment);
    console.log('Refresh attachment', resp);
  }

  // const filename = 'assets/熱烈歓迎にたじたじ.png';

  // await thread.post({
  //   markdown: '',
  //   files: [
  //     {
  //       data: await fs.promises.readFile(filename),
  //       filename: path.basename(filename)
  //     }
  //   ]
  // });
});

// await bot.shutdown();
// await bot.getAdapter('qq').disconnect();
