import type { Author } from 'chat';

import { ValidationError } from '@chat-adapter/shared';

import type {
  QQFriendInfo,
  QQGroupMemberInfo,
  QQLoginInfo,
  QQMemberProfile,
  QQRawMessage,
  QQStrangerInfo,
  QQThreadId
} from './types.js';

/** 将字符串 ID 转为正整数，失败时抛出 ValidationError。 */
export function toNumberId(value: string, fieldName: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError('qq', `QQ ${fieldName} must be a positive integer: ${value}`);
  }
  return num;
}

/** 判断消息是否由 bot 自己发送（用于避免回环处理）。 */
export function isSelfMessage(raw: QQRawMessage, selfId?: string): boolean {
  if (!selfId) {
    return false;
  }

  return String(raw.user_id) === selfId;
}

/** 判断消息是否命中 mention 语义。 */
export function isMention(raw: QQRawMessage, selfId?: string): boolean {
  if (raw.message_type === 'private') {
    return true;
  }

  if (!selfId) {
    return false;
  }

  return raw.message.some(
    (segment) =>
      segment.type === 'at' && segment.data.qq !== 'all' && String(segment.data.qq) === selfId
  );
}

/** 将 QQ 原始消息映射为统一的 QQ thread ID 结构。 */
export function toThreadId(raw: QQRawMessage): QQThreadId {
  if (raw.message_type === 'group') {
    return {
      chatType: 'group',
      peerId: String(raw.group_id)
    };
  }

  return {
    chatType: 'private',
    peerId: String(raw.user_id)
  };
}

/** 将 QQ 原始作者信息映射为 Chat SDK Author。 */
export function toAuthor(raw: QQRawMessage, isMe: boolean): Author {
  const userId = String(raw.user_id);
  const userName = raw.sender.card || raw.sender.nickname || String(raw.user_id);

  return {
    userId,
    userName,
    fullName: userName,
    isBot: isMe,
    isMe
  };
}

/** 将群成员信息转换为统一成员结构。 */
export function toGroupMemberProfile(member: QQGroupMemberInfo, selfId?: string): QQMemberProfile {
  const userId = String(member.user_id);
  const isMe = selfId !== undefined && userId === selfId;

  return {
    userId,
    userName: member.nickname || userId,
    cardName: member.card || '',
    isBot: member.is_robot,
    isMe,
    raw: member
  };
}

/** 将登录信息转换为“自己”的统一成员结构。 */
export function toSelfMemberProfile(login: QQLoginInfo): QQMemberProfile {
  const userId = String(login.user_id);

  return {
    userId,
    userName: login.nickname || userId,
    cardName: '',
    isBot: true,
    isMe: true,
    raw: login
  };
}

/** 将私聊对端资料转换为统一成员结构。 */
export function toPrivatePeerMemberProfile(
  peer: QQStrangerInfo,
  selfUserId: string
): QQMemberProfile {
  const userId = String(peer.user_id);
  const isMe = userId === selfUserId;

  return {
    userId,
    userName: peer.nickname || peer.nick || userId,
    cardName: peer.remark || '',
    isBot: isMe,
    isMe,
    raw: peer
  };
}

/** 将私聊好友资料（好友列表条目）转换为统一成员结构。 */
export function toPrivateFriendMemberProfile(
  friend: QQFriendInfo,
  selfUserId: string
): QQMemberProfile {
  const userId = String(friend.user_id);
  const isMe = userId === selfUserId;

  return {
    userId,
    userName: friend.nickname || userId,
    cardName: friend.remark || '',
    isBot: isMe,
    isMe,
    raw: friend
  };
}
