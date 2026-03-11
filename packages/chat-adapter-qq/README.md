# chat-adapter-qq

[![npm version](https://img.shields.io/npm/v/chat-adapter-qq)](https://www.npmjs.com/package/chat-adapter-qq)
[![npm downloads](https://img.shields.io/npm/dm/chat-adapter-qq)](https://www.npmjs.com/package/chat-adapter-qq)
[![CI](https://github.com/yjl9903/chat-adapter-qq/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/chat-adapter-qq/actions/workflows/ci.yml)

基于 [NapCat](https://napneko.github.io/) 和 [node-napcat-ts](https://node-napcat-ts.huankong.top/) 的 [Chat SDK](https://chat-sdk.dev/docs) **QQ 适配器**.

## 安装

```bash
npm install chat chat-adapter-qq
```

## 快速开始

1. 参考 [NapCat](https://napneko.github.io/) 文档部署一个正向 WebSocket 服务端.

2. 参考 [node-napcat-ts](https://node-napcat-ts.huankong.top/) 配置连接信息.

```ts
import { Chat } from 'chat';
import { createMemoryState } from '@chat-adapter/state-memory';
import { createQQAdapter } from 'chat-adapter-qq';

const bot = new Chat({
  userName: '',
  adapters: {
    qq: createQQAdapter({
      napcat: {
        protocol: 'wss',
        host: '<your napcat host>',
        port: 443,
        accessToken: '<your napcat access token>',
        // ↓ 自动重连 (可选)
        reconnection: {
          enable: true,
          attempts: 10,
          delay: 5000
        }
      },
      // ↓ 心跳轮询 (可选，默认启用)
      heartbeat: {
        intervalMs: 30_000,
        failureThreshold: 2,
        reconnectOnFailure: true
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
});

bot.onSubscribedMessage(async (thread, message) => {
  bot.getLogger(thread.adapter.name).info('onSubscribedMessage', message);
  await thread.post(`收到消息: ${message.text}`);
});
```

## 引用

- [NapCatQQ](https://napneko.github.io/): 现代化的基于 NTQQ 的 Bot 协议端实现.
- [node-napcat-ts](https://node-napcat-ts.huankong.top/): 由 Typescript 编写的 NapcatQQ SDK.
- [Chat SDK](https://chat-sdk.dev/docs): A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more. Write your bot logic once, deploy everywhere.

## 开源协议

MIT License © 2026 [XLor](https://github.com/yjl9903)
