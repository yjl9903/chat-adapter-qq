import type { SendMessageSegment } from 'node-napcat-ts';
import {
  createQQAdapter,
  type QQGroupMemberInfo,
  type QQNapcatClient,
  type QQGroupMessage,
  type QQPrivateMessage,
  type QQRawMessage
} from '../src/index.js';

type HistoryParams = {
  message_seq?: number;
  count?: number;
  reverseOrder?: boolean;
};

export class MockNapcatClient {
  connectCalls = 0;
  deletedMessages: number[] = [];
  sentGroupMessages: Array<{ group_id: number; message: SendMessageSegment[] }> = [];
  sentPrivateMessages: Array<{ user_id: number; message: SendMessageSegment[] }> = [];
  emojiLikeCalls: Array<{ message_id: number; emoji_id: string; set?: boolean }> = [];
  groupHistoryCalls: Array<{ group_id: number; message_seq?: number; count?: number }> = [];
  friendHistoryCalls: Array<{ user_id: number; message_seq?: number; count?: number }> = [];
  inputStatusCalls: Array<{ user_id: string; event_type: number }> = [];
  getMsgCalls: number[] = [];
  getGroupInfoCalls: number[] = [];
  getGroupMemberListCalls: number[] = [];
  getGroupMemberInfoCalls: Array<{ group_id: number; user_id: number }> = [];
  getFriendListCalls = 0;
  getStrangerInfoCalls: number[] = [];

  private nextMessageId = 1000;
  private readonly groupHandlers: Array<(event: QQGroupMessage) => void> = [];
  private readonly privateHandlers: Array<(event: QQPrivateMessage) => void> = [];
  private readonly groupHistory = new Map<number, QQRawMessage[]>();
  private readonly friendHistory = new Map<number, QQRawMessage[]>();
  private readonly messagesById = new Map<number, QQRawMessage>();
  private readonly groupInfoById = new Map<
    number,
    {
      group_all_shut: number;
      group_remark: string;
      group_id: number;
      group_name: string;
      member_count: number;
      max_member_count: number;
    }
  >();
  private readonly groupMembersById = new Map<number, QQGroupMemberInfo[]>();
  private friendList: Array<{
    birthday_year: number;
    birthday_month: number;
    birthday_day: number;
    user_id: number;
    age: number;
    phone_num: string;
    email: string;
    category_id: number;
    nickname: string;
    remark: string;
    sex: 'male' | 'female' | 'unknown';
    level: number;
  }> = [];
  private readonly strangerInfoById = new Map<
    number,
    {
      user_id: number;
      nickname: string;
      nick: string;
      remark: string;
      sex: 'male' | 'female' | 'unknown';
      qid: string;
      qqLevel: number;
    }
  >();

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

  async set_msg_emoji_like(params: {
    message_id: number;
    emoji_id: string;
    set?: boolean;
  }): Promise<{ result: 0; errMsg: string }> {
    this.emojiLikeCalls.push(params);
    return {
      result: 0,
      errMsg: ''
    };
  }

  async get_group_msg_history(params: {
    group_id: number;
    message_seq?: number;
    count?: number;
    reverseOrder?: boolean;
  }): Promise<{ messages: QQRawMessage[] }> {
    this.groupHistoryCalls.push({
      group_id: params.group_id,
      message_seq: params.message_seq,
      count: params.count
    });
    const source = this.groupHistory.get(params.group_id) ?? [];
    return {
      messages: this.paginateHistory(source, params)
    };
  }

  async get_friend_msg_history(params: {
    user_id: number;
    message_seq?: number;
    count?: number;
    reverseOrder?: boolean;
  }): Promise<{ messages: QQRawMessage[] }> {
    this.friendHistoryCalls.push({
      user_id: params.user_id,
      message_seq: params.message_seq,
      count: params.count
    });
    const source = this.friendHistory.get(params.user_id) ?? [];
    return {
      messages: this.paginateHistory(source, params)
    };
  }

  async get_msg(params: { message_id: number }): Promise<QQRawMessage> {
    this.getMsgCalls.push(params.message_id);
    const found = this.messagesById.get(params.message_id);
    if (!found) {
      throw new Error(`Message not found: ${params.message_id}`);
    }
    return found;
  }

  async get_group_info(params: { group_id: number }): Promise<{
    group_all_shut: number;
    group_remark: string;
    group_id: number;
    group_name: string;
    member_count: number;
    max_member_count: number;
  }> {
    this.getGroupInfoCalls.push(params.group_id);
    return (
      this.groupInfoById.get(params.group_id) ?? {
        group_all_shut: 0,
        group_remark: '',
        group_id: params.group_id,
        group_name: `group-${params.group_id}`,
        member_count: 0,
        max_member_count: 0
      }
    );
  }

  async get_group_member_info(params: {
    group_id: number;
    user_id: number;
  }): Promise<QQGroupMemberInfo> {
    this.getGroupMemberInfoCalls.push(params);
    const members = this.groupMembersById.get(params.group_id) ?? [];
    const found = members.find((item) => item.user_id === params.user_id);
    if (!found) {
      throw new Error(`Group member not found: group=${params.group_id} user=${params.user_id}`);
    }

    return found;
  }

  async get_group_member_list(params: { group_id: number }): Promise<QQGroupMemberInfo[]> {
    this.getGroupMemberListCalls.push(params.group_id);
    return this.groupMembersById.get(params.group_id) ?? [];
  }

  async get_friend_list(): Promise<
    Array<{
      birthday_year: number;
      birthday_month: number;
      birthday_day: number;
      user_id: number;
      age: number;
      phone_num: string;
      email: string;
      category_id: number;
      nickname: string;
      remark: string;
      sex: 'male' | 'female' | 'unknown';
      level: number;
    }>
  > {
    this.getFriendListCalls += 1;
    return this.friendList;
  }

  async get_stranger_info(params: { user_id: number }): Promise<{
    user_id: number;
    nickname: string;
    nick: string;
    remark: string;
    sex: 'male' | 'female' | 'unknown';
    qid: string;
    qqLevel: number;
  }> {
    this.getStrangerInfoCalls.push(params.user_id);
    return (
      this.strangerInfoById.get(params.user_id) ?? {
        user_id: params.user_id,
        nickname: `user-${params.user_id}`,
        nick: `user-${params.user_id}`,
        remark: '',
        sex: 'unknown',
        qid: '',
        qqLevel: 0
      }
    );
  }

  async set_input_status(params: {
    user_id: string;
    event_type: number;
  }): Promise<{ result: 0; errMsg: string }> {
    this.inputStatusCalls.push(params);
    return {
      result: 0,
      errMsg: ''
    };
  }

  setGroupHistory(groupId: number, messages: QQRawMessage[]): void {
    this.groupHistory.set(groupId, messages);
    for (const message of messages) {
      this.messagesById.set(message.message_id, message);
    }
  }

  setFriendHistory(userId: number, messages: QQRawMessage[]): void {
    this.friendHistory.set(userId, messages);
    for (const message of messages) {
      this.messagesById.set(message.message_id, message);
    }
  }

  setMessage(message: QQRawMessage): void {
    this.messagesById.set(message.message_id, message);
  }

  setGroupInfo(
    groupId: number,
    info: {
      group_all_shut: number;
      group_remark: string;
      group_id: number;
      group_name: string;
      member_count: number;
      max_member_count: number;
    }
  ): void {
    this.groupInfoById.set(groupId, info);
  }

  setStrangerInfo(
    userId: number,
    info: {
      user_id: number;
      nickname: string;
      nick: string;
      remark: string;
      sex: 'male' | 'female' | 'unknown';
      qid: string;
      qqLevel: number;
    }
  ): void {
    this.strangerInfoById.set(userId, info);
  }

  setGroupMembers(groupId: number, members: QQGroupMemberInfo[]): void {
    this.groupMembersById.set(groupId, members);
  }

  setFriendList(
    list: Array<{
      birthday_year: number;
      birthday_month: number;
      birthday_day: number;
      user_id: number;
      age: number;
      phone_num: string;
      email: string;
      category_id: number;
      nickname: string;
      remark: string;
      sex: 'male' | 'female' | 'unknown';
      level: number;
    }>
  ): void {
    this.friendList = list;
  }

  private paginateHistory(messages: QQRawMessage[], params: HistoryParams): QQRawMessage[] {
    const sorted = [...messages].sort((a, b) => a.message_seq - b.message_seq);
    const count = params.count ?? 50;
    const cursor = params.message_seq;

    if (params.reverseOrder) {
      const candidates = cursor ? sorted.filter((item) => item.message_seq <= cursor) : sorted;
      return candidates.slice(-count);
    }

    const candidates = cursor ? sorted.filter((item) => item.message_seq >= cursor) : sorted;
    return candidates.slice(0, count);
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
    messageSeq?: number;
    time?: number;
    rawMessage?: string;
  }
): QQGroupMessage {
  const messageId = options?.messageId ?? 123;
  return {
    self_id: 10001,
    user_id: options?.userId ?? 20002,
    time: options?.time ?? 1710000000,
    message_id: messageId,
    message_seq: options?.messageSeq ?? messageId,
    real_id: messageId,
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
    messageSeq?: number;
    time?: number;
    rawMessage?: string;
  }
): QQPrivateMessage {
  const messageId = options?.messageId ?? 321;
  return {
    self_id: 10001,
    user_id: options?.userId ?? 20002,
    time: options?.time ?? 1710000000,
    message_id: messageId,
    message_seq: options?.messageSeq ?? messageId,
    real_id: messageId,
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

export function createGroupMemberInfo(options?: {
  groupId?: number;
  userId?: number;
  nickname?: string;
  card?: string;
  isRobot?: boolean;
  role?: 'owner' | 'admin' | 'member';
}): QQGroupMemberInfo {
  return {
    group_id: options?.groupId ?? 30003,
    user_id: options?.userId ?? 20002,
    nickname: options?.nickname ?? 'alice',
    card: options?.card ?? '',
    sex: 'unknown',
    age: 0,
    area: '',
    level: '0',
    qq_level: 0,
    join_time: 0,
    last_sent_time: 0,
    title_expire_time: 0,
    unfriendly: false,
    card_changeable: true,
    is_robot: options?.isRobot ?? false,
    shut_up_timestamp: 0,
    role: options?.role ?? 'member',
    title: ''
  };
}

export function createFriendInfo(options?: {
  userId?: number;
  nickname?: string;
  remark?: string;
  sex?: 'male' | 'female' | 'unknown';
  level?: number;
}) {
  return {
    birthday_year: 0,
    birthday_month: 0,
    birthday_day: 0,
    user_id: options?.userId ?? 20002,
    age: 0,
    phone_num: '',
    email: '',
    category_id: 0,
    nickname: options?.nickname ?? 'alice',
    remark: options?.remark ?? '',
    sex: options?.sex ?? 'unknown',
    level: options?.level ?? 0
  };
}
