import type { Receive } from 'node-napcat-ts';

import { ValidationError } from '@chat-adapter/shared';
import { parseMarkdown, toPlainText, type Attachment, type Author } from 'chat';

import type { QQRawMessage, QQThreadId } from './types.js';

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
