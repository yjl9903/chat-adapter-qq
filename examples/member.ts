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

const privateMembers = await adapter.fetchThreadMembers(process.env.NAPCAT_PRIVATE_THREAD_ID!);
console.log('private', privateMembers);

const groupMembers = await adapter.fetchThreadMembers(process.env.NAPCAT_GROUP_THREAD_ID!);
console.log('group', groupMembers);

await bot.shutdown();

process.exit();
