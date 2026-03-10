import 'dotenv/config';

import { NCWebsocket, Structs } from 'node-napcat-ts';

const napcat = new NCWebsocket(
  {
    protocol: 'wss',
    host: process.env.NAPCAT_HOST!,
    port: 443,
    accessToken: process.env.NAPCAT_ACCESS_TOKEN,
    // 是否需要在触发 socket.error 时抛出错误, 默认关闭
    throwPromise: true,
    // ↓ 自动重连(可选)
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000
    }
  },
  // ↓ 是否开启 DEBUG 模式
  false
);

console.log('connecting...');

await napcat.connect();

console.log('napcat connected');

// const resp = await napcat.get_friend_list();
// console.log(resp);

const resp = await napcat.send_private_msg({
  user_id: 834458085,
  message: [Structs.text('你好')]
});

console.log(resp);
