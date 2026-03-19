import 'dotenv/config';
import fs from 'node:fs';

import { type Message, Chat, emoji, paragraph, root, stringifyMarkdown, text } from 'chat';

import { createSqliteState } from '../packages/chat-adapter-sqlite/src/index.js';
import { createQQAdapter, at, reply } from '../packages/chat-adapter-qq/src/index.js';

process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});

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

bot.onNewMention(async (thread, message) => {
  bot.getLogger(thread.adapter.name).info('onNewMention', message);
  bot.getLogger(thread.adapter.name).info(stringifyMarkdown(message.formatted));

  await thread.subscribe();
  await thread.post(`订阅频道: ${message.text}`);
  await writeMessage(message);
});

bot.onSubscribedMessage(async (thread, message) => {
  bot.getLogger(thread.adapter.name).info('onSubscribedMessage', message);
  bot.getLogger(thread.adapter.name).info(stringifyMarkdown(message.formatted));

  await thread.refresh();

  // await thread.post({
  //   ast: root([forward(...thread.recentMessages.slice(-5).map((m) => m.id))])
  // });

  await thread.post({
    ast: root([
      reply(message.id),
      paragraph([at(message.author.userId), text(' '), text('测试回复')])
    ])
  });

  await writeMessage(message);

  const adapter = bot.getAdapter('qq');
  const threadId = adapter.decodeThreadId(thread.id);
  if (threadId.chatType === 'group') {
    adapter.addReaction(thread.id, message.id, emoji.thumbs_up);
  }
});

async function writeMessage(message: Message<unknown>) {
  await fs.promises.writeFile(
    `.profile/${message.id}.json`,
    JSON.stringify(message.raw, null, 2),
    'utf-8'
  );
}
