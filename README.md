# chat-adapter-qq

[![npm version](https://img.shields.io/npm/v/chat-adapter-qq)](https://www.npmjs.com/package/chat-adapter-qq)
[![npm downloads](https://img.shields.io/npm/dm/chat-adapter-qq)](https://www.npmjs.com/package/chat-adapter-qq)
[![CI](https://github.com/yjl9903/chat-adapter-qq/actions/workflows/ci.yml/badge.svg)](https://github.com/yjl9903/chat-adapter-qq/actions/workflows/ci.yml)

基于 [NapCat](https://napneko.github.io/) 的 [Chat SDK](https://chat-sdk.dev/docs) **QQ 适配器**.

- 支持接入 QQ 群聊 / 私聊消息接入
- 支持发送文本消息、撤回消息
- 支持群聊消息贴表情和私聊输入状态。
- 支持查询消息记录 / 成员列表 / 成员信息
- 支持渲染 QQ 消息内容到 markdown 格式, 包括: 图片, 文件, 回复消息, 合并转发消息等格式
- 支持发送图片 / 音视频 / 文件 / 引用消息 / 合并转发消息等格式

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

## 功能示例

示例脚本见: [`examples/chat.ts`](./examples/chat.ts).

### 1. 提及机器人后订阅 Thread

```ts
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`已开始监听当前会话: ${message.text}`);
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`收到消息: ${message.text}`);
});
```

### 2. 发送文本

```ts
await thread.post('hello qq');
```

### 3. 发送引用消息和合并转发

```ts
await thread.post({
  reply: message.id,
  markdown: `@${message.author.userId} 收到`
});

await thread.post({
  forward: thread.recentMessages.slice(-3).map((item) => item.id),
  markdown: '',
});
```

### 4. 发送图片 / 音视频 / 文件

本地上传使用 `files`, 已有远程资源使用 `attachments`。

```ts
import fs from 'node:fs';
import path from 'node:path';

const filename = 'assets/avatar.jpeg';

await thread.post({
  markdown: '本地文件上传',
  files: [
    {
      data: await fs.promises.readFile(filename),
      filename: path.basename(filename),
      mimeType: 'image/jpeg'
    }
  ]
});

await thread.post({
  markdown: '远程图片',
  attachments: [
    {
      type: 'image',
      name: 'cover.jpg',
      url: 'https://example.com/cover.jpg'
    }
  ]
});
```

### 5. 读取解析后的消息内容

收到的 QQ 消息会被统一解析成 `text`、`formatted` 和 `attachments`:

```ts
import { stringifyMarkdown } from 'chat';

bot.onSubscribedMessage(async (_thread, message) => {
  console.log('plain text:', message.text);
  console.log('markdown:', stringifyMarkdown(message.formatted));
  console.log('attachments:', message.attachments);
});
```

当前会处理文本、`@提及`、图片、文件、视频、音频、回复消息、合并转发等格式。

### 6. 表情回应和输入状态

```ts
import { emoji } from 'chat';

await thread.startTyping('typing');

await bot.getAdapter('qq').addReaction(thread.id, message.id, emoji.thumbs_up);
await bot.getAdapter('qq').removeReaction(thread.id, message.id, '128077');
```

### 7. 查询历史消息

```ts
const adapter = bot.getAdapter('qq');

const latest = await adapter.fetchMessages('qq:group:30003', { limit: 20 });
console.log(latest.messages.map((item) => [item.id, item.text]));

if (latest.nextCursor) {
  const older = await adapter.fetchMessages('qq:group:30003', {
    limit: 20,
    cursor: latest.nextCursor
  });
  console.log(older.messages.map((item) => [item.id, item.text]));
}
```

### 8. 查询会话 / 成员 / 私聊

```ts
const adapter = bot.getAdapter('qq');

const threadInfo = await adapter.fetchThread('qq:group:30003');
const members = await adapter.fetchThreadMembers('qq:group:30003');
const member = await adapter.fetchThreadMember('qq:group:30003', '20002');
const dmThreadId = await adapter.openDM('20002');

console.log(threadInfo.channelName);
console.log(members.length);
console.log(member?.userName);
console.log(dmThreadId); // qq:private:20002
```

## 引用

- [NapCatQQ](https://napneko.github.io/): 现代化的基于 NTQQ 的 Bot 协议端实现.
- [node-napcat-ts](https://node-napcat-ts.huankong.top/): 由 Typescript 编写的 NapcatQQ SDK.
- [Chat SDK](https://chat-sdk.dev/docs): A unified TypeScript SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more. Write your bot logic once, deploy everywhere.

## 开源协议

MIT License © 2026 [XLor](https://github.com/yjl9903)
