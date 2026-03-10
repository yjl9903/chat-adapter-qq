import type { Receive } from 'node-napcat-ts';

import { ValidationError } from '@chat-adapter/shared';
import { parseMarkdown, toPlainText, type Attachment, type Author } from 'chat';

import type { QQRawMessage, QQThreadId } from './types.js';

/** NapCat 入站 message segment 的联合类型。 */
export type QQMessageSegment = Receive[keyof Receive];

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

/** 从 NapCat segment 列表提取纯文本；必要时回退 raw_message。 */
export function extractText(raw: QQRawMessage): string {
  const text = raw.message.map(segmentToText).join('');
  if (text.length > 0) {
    return text;
  }

  return raw.raw_message ? toPlainText(parseMarkdown(raw.raw_message)) : '';
}

/** 将 NapCat segment 中可识别的媒体映射为 Chat SDK attachments。 */
export function toAttachments(message: QQMessageSegment[]): Attachment[] {
  return message
    .map((segment) => {
      if (segment.type === 'image') {
        return {
          type: 'image' as const,
          url: 'url' in segment.data ? segment.data.url : undefined
        };
      }

      if (segment.type === 'file') {
        return {
          type: 'file' as const,
          name: segment.data.file
        };
      }

      if (segment.type === 'video') {
        return {
          type: 'video' as const,
          url: segment.data.url,
          name: segment.data.file
        };
      }

      if (segment.type === 'record') {
        return {
          type: 'audio' as const,
          name: segment.data.file
        };
      }

      return null;
    })
    .filter((attachment): attachment is NonNullable<typeof attachment> => attachment !== null);
}

/** 将单个 NapCat segment 转为可读文本片段。 */
export function segmentToText(segment: QQMessageSegment): string {
  if (segment.type === 'text') {
    return segment.data.text;
  }

  if (segment.type === 'at') {
    return segment.data.qq === 'all' ? '@all' : `@${segment.data.qq}`;
  }

  if (segment.type === 'face') {
    return `[face:${segment.data.id}]`;
  }

  if (segment.type === 'image') {
    return '[image]';
  }

  if (segment.type === 'file') {
    return `[file:${segment.data.file}]`;
  }

  if (segment.type === 'record') {
    return '[audio]';
  }

  if (segment.type === 'video') {
    return '[video]';
  }

  if (segment.type === 'markdown') {
    return segment.data.content;
  }

  return '';
}
