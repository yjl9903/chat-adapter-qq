import {
  type Root,
  type Attachment,
  BaseFormatConverter,
  toPlainText,
  parseMarkdown,
  stringifyMarkdown
} from 'chat';
import type { Receive } from 'node-napcat-ts';

import type { QQNapcatClient, QQRawMessage } from './types.js';

/** NapCat 入站 message segment 的联合类型。 */
export type QQMessageSegment = Receive[keyof Receive];

/**
 * @todo
 */
export class QQFormatConverter extends BaseFormatConverter {
  public constructor(_client?: QQNapcatClient) {
    super();
  }

  public toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  public fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }
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
