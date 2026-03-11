import { createMemoryState } from '@chat-adapter/state-memory';
import { type Message, type Thread, Chat } from 'chat';

import { createQQAdapter, type QQGroupMessage, type QQPrivateMessage } from '../src/index.js';

import { attachMockClient, MockNapcatClient } from './napcat-mock.js';

export async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Condition not met within timeout');
}

export async function createQQTestContext(handlers?: {
  onMention?: (thread: Thread, message: Message) => void | Promise<void>;
  onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
}) {
  const client = new MockNapcatClient();
  const adapter = createQQAdapter({
    napcat: { baseUrl: 'ws://localhost:3001' }
  });
  attachMockClient(adapter, client);

  const chat = new Chat({
    userName: 'qq-bot',
    adapters: { qq: adapter },
    state: createMemoryState(),
    logger: 'error'
  });

  const captured: {
    mentionMessage: Message | null;
    followUpMessage: Message | null;
  } = {
    mentionMessage: null,
    followUpMessage: null
  };

  if (handlers?.onMention) {
    chat.onNewMention(async (thread, message) => {
      captured.mentionMessage = message;
      await handlers.onMention!(thread, message);
    });
  }

  if (handlers?.onSubscribed) {
    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpMessage = message;
      await handlers.onSubscribed!(thread, message);
    });
  }

  await chat.initialize();

  return {
    client,
    adapter,
    chat,
    captured,
    sendGroup: async (event: QQGroupMessage) => {
      client.emitGroup(event);
      await flush();
    },
    sendPrivate: async (event: QQPrivateMessage) => {
      client.emitPrivate(event);
      await flush();
    }
  };
}
