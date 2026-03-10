import type { SendMessageSegment } from 'node-napcat-ts';
import {
  createQQAdapter,
  type QQNapcatClient,
  type QQGroupMessage,
  type QQPrivateMessage
} from '../src/index.js';

export class MockNapcatClient {
  connectCalls = 0;
  deletedMessages: number[] = [];
  sentGroupMessages: Array<{ group_id: number; message: SendMessageSegment[] }> = [];
  sentPrivateMessages: Array<{ user_id: number; message: SendMessageSegment[] }> = [];

  private nextMessageId = 1000;
  private readonly groupHandlers: Array<(event: QQGroupMessage) => void> = [];
  private readonly privateHandlers: Array<(event: QQPrivateMessage) => void> = [];

  async connect(): Promise<void> {
    this.connectCalls += 1;
  }

  on(event: string, handler: (event: QQGroupMessage | QQPrivateMessage) => void): this {
    if (event === 'message.group') {
      this.groupHandlers.push(handler as (event: QQGroupMessage) => void);
    } else if (event === 'message.private') {
      this.privateHandlers.push(handler as (event: QQPrivateMessage) => void);
    }

    return this;
  }

  emitGroup(event: QQGroupMessage): void {
    for (const handler of this.groupHandlers) {
      handler(event);
    }
  }

  emitPrivate(event: QQPrivateMessage): void {
    for (const handler of this.privateHandlers) {
      handler(event);
    }
  }

  async get_login_info(): Promise<{ user_id: number; nickname: string }> {
    return {
      user_id: 10001,
      nickname: 'qq-bot'
    };
  }

  async send_group_msg(params: {
    group_id: number;
    message: SendMessageSegment[];
  }): Promise<{ message_id: number }> {
    this.sentGroupMessages.push(params);
    return { message_id: this.nextMessageId++ };
  }

  async send_private_msg(params: {
    user_id: number;
    message: SendMessageSegment[];
  }): Promise<{ message_id: number }> {
    this.sentPrivateMessages.push(params);
    return { message_id: this.nextMessageId++ };
  }

  async delete_msg(params: { message_id: number }): Promise<null> {
    this.deletedMessages.push(params.message_id);
    return null;
  }
}

export function attachMockClient(
  adapter: ReturnType<typeof createQQAdapter>,
  client: MockNapcatClient
): void {
  (adapter as unknown as { client: QQNapcatClient }).client = client as unknown as QQNapcatClient;
}

export function createGroupMessage(
  message: QQGroupMessage['message'],
  options?: {
    userId?: number;
    groupId?: number;
    messageId?: number;
    rawMessage?: string;
  }
): QQGroupMessage {
  return {
    self_id: 10001,
    user_id: options?.userId ?? 20002,
    time: 1710000000,
    message_id: options?.messageId ?? 123,
    message_seq: 123,
    real_id: 123,
    message_type: 'group',
    sender: {
      user_id: options?.userId ?? 20002,
      nickname: 'alice',
      card: ''
    },
    raw_message: options?.rawMessage ?? 'raw',
    font: 14,
    sub_type: 'normal',
    post_type: 'message',
    group_id: options?.groupId ?? 30003,
    quick_action: async () => null,
    message_format: 'array',
    message
  };
}

export function createPrivateMessage(
  message: QQPrivateMessage['message'],
  options?: {
    userId?: number;
    messageId?: number;
    rawMessage?: string;
  }
): QQPrivateMessage {
  return {
    self_id: 10001,
    user_id: options?.userId ?? 20002,
    time: 1710000000,
    message_id: options?.messageId ?? 321,
    message_seq: 321,
    real_id: 321,
    message_type: 'private',
    sender: {
      user_id: options?.userId ?? 20002,
      nickname: 'alice',
      card: ''
    },
    raw_message: options?.rawMessage ?? 'raw',
    font: 14,
    sub_type: 'friend',
    post_type: 'message',
    quick_action: async () => null,
    message_format: 'array',
    message
  };
}
