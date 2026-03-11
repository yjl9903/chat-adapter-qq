import {
  type Root,
  type Attachment,
  BaseFormatConverter,
  parseMarkdown,
  stringifyMarkdown
} from 'chat';
import type { Receive } from 'node-napcat-ts';

import type { QQNapcatClient, QQRawMessage } from '../types.js';

import { isHttpUrl, parseSize, basename } from './utils.js';
import { toPlainTextPreserveBreaks } from './to-plain-text.js';

/** NapCat 入站 message segment 的联合类型。 */
export type QQMessageSegment = Receive[keyof Receive];

export interface QQParsedIncomingMessage {
  markdown: string;
  formatted: Root;
  text: string;
  attachments: Attachment[];
}

const FILTERED_SEGMENT_TYPES = new Set(['rps', 'poke', 'shake']);

function isFilteredSegment(segment: QQMessageSegment): boolean {
  return FILTERED_SEGMENT_TYPES.has(segment.type);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]\\]/g, '\\$&');
}

function toMarkdownLink(label: string, url: string): string {
  return `[${escapeMarkdownLabel(label)}](${url})`;
}

function asOwnLine(content: string): string {
  return `\n${content}\n`;
}

function toReplyPlaceholder(messageId: string): string {
  return `\n\n> 回复消息 #${messageId}\n\n`;
}

function toForwardPlaceholder(forwardId: string): string {
  return `\n\n> 转发消息 #${forwardId}\n\n`;
}

function toReplyQuoteMarkdown(
  authorName: string,
  authorId: string,
  messageBodyMarkdown: string
): string {
  const normalizedAuthor = authorName.trim() || '未知发送人';
  const header = `${normalizedAuthor} (qq ${authorId}):`;
  const normalizedBody = messageBodyMarkdown.replace(/\r\n?/g, '\n');
  const rawLines = normalizedBody.split('\n').map((line) => line.trimEnd());

  // Keep internal empty lines, but trim leading/trailing empty rows.
  while (rawLines.length > 0 && rawLines[0] === '') {
    rawLines.shift();
  }
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  if (rawLines.length === 0) {
    return `\n\n> ${header}\n\n`;
  }

  const quoteLines = [header, ...rawLines].map((line) => (line.length > 0 ? `> ${line}` : '>'));

  return `\n\n${quoteLines.join('\n')}\n\n`;
}

function attachmentFromSegment(segment: QQMessageSegment): Attachment | null {
  if (segment.type === 'image') {
    const fileName = basename(segment.data.file, 'image');
    const size = 'file_size' in segment.data ? parseSize(segment.data.file_size) : undefined;

    return {
      type: 'image',
      name: fileName,
      url: segment.data.url,
      size
    };
  }

  if (segment.type === 'file') {
    return {
      type: 'file',
      name: basename(segment.data.file, 'file'),
      size: parseSize(segment.data.file_size)
    };
  }

  if (segment.type === 'video') {
    return {
      type: 'video',
      name: basename(segment.data.file, 'video'),
      url: segment.data.url,
      size: parseSize(segment.data.file_size)
    };
  }

  if (segment.type === 'record') {
    return {
      type: 'audio',
      name: basename(segment.data.file, 'audio'),
      size: parseSize(segment.data.file_size)
    };
  }

  return null;
}

export class QQFormatConverter extends BaseFormatConverter {
  private readonly client?: QQNapcatClient;

  public constructor(client?: QQNapcatClient) {
    super();
    this.client = client;
  }

  public toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  public fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  public parseIncomingSync(raw: QQRawMessage): QQParsedIncomingMessage {
    const segments = raw.message;
    const markdownParts: string[] = [];
    const attachments: Attachment[] = [];

    for (const segment of segments) {
      if (isFilteredSegment(segment)) {
        continue;
      }

      const markdown = this.segmentToMarkdown(segment);
      if (markdown.length > 0) {
        markdownParts.push(markdown);
      }

      const attachment = attachmentFromSegment(segment);
      if (attachment) {
        attachments.push(attachment);
      }
    }

    return this.finalizeParsedMessage(raw, segments, markdownParts, attachments);
  }

  /** 将 NapCat raw message 转为 markdown / ast / text / attachments。 */
  public async parseIncoming(raw: QQRawMessage): Promise<QQParsedIncomingMessage> {
    const segments = raw.message;
    const markdownParts: string[] = [];
    const attachments: Attachment[] = [];

    const activeSegments = segments.filter((segment) => !isFilteredSegment(segment));
    if (activeSegments.length === 1 && activeSegments[0].type === 'forward') {
      const markdown = await this.fetchForwardMessage(raw.message_id, activeSegments[0].data.id);
      if (markdown.length > 0) {
        markdownParts.push(markdown);
      }
      return this.finalizeParsedMessage(raw, segments, markdownParts, attachments);
    }

    let activeIndex = 0;
    for (const segment of segments) {
      if (isFilteredSegment(segment)) {
        continue;
      }

      let markdown: string;
      // Assumption: reply only appears at the beginning of a message.
      if (segment.type === 'reply' && activeIndex === 0) {
        markdown = await this.fetchReplyMessage(segment.data.id);
      } else {
        markdown = this.segmentToMarkdown(segment);
      }
      activeIndex += 1;

      if (markdown.length > 0) {
        markdownParts.push(markdown);
      }

      const attachment = attachmentFromSegment(segment);
      if (attachment) {
        attachments.push(attachment);
      }
    }

    return this.finalizeParsedMessage(raw, segments, markdownParts, attachments);
  }

  private async fetchReplyMessage(messageId: string): Promise<string> {
    const client = this.client;
    if (!client) {
      return toReplyPlaceholder(messageId);
    }

    const numericMessageId = Number(messageId);
    if (!Number.isInteger(numericMessageId) || numericMessageId <= 0) {
      return toReplyPlaceholder(messageId);
    }

    try {
      const replyMessage = await client.get_msg({
        message_id: numericMessageId
      });

      const authorName =
        replyMessage.sender.card || replyMessage.sender.nickname || String(replyMessage.user_id);
      const authorId = String(replyMessage.user_id);

      const bodyMarkdown = this.parseIncomingSync(replyMessage).markdown;
      if (!bodyMarkdown.trim()) {
        return toReplyPlaceholder(messageId);
      }

      return toReplyQuoteMarkdown(authorName, authorId, bodyMarkdown);
    } catch {
      return toReplyPlaceholder(messageId);
    }
  }

  private async fetchForwardMessage(messageId: number, forwardId: string): Promise<string> {
    const client = this.client;
    if (!client) {
      return toForwardPlaceholder(forwardId);
    }

    try {
      const expandedMessage = await client.get_msg({
        message_id: messageId
      });
      const expandedMarkdown = this.parseIncomingSync(expandedMessage).markdown;

      if (!expandedMarkdown.trim()) {
        return toForwardPlaceholder(forwardId);
      }

      return expandedMarkdown;
    } catch {
      return toForwardPlaceholder(forwardId);
    }
  }

  private segmentToMarkdown(segment: QQMessageSegment): string {
    if (segment.type === 'text') {
      return segment.data.text;
    }

    if (segment.type === 'at') {
      return segment.data.qq === 'all' ? '@所有人 ' : `@${segment.data.qq} `;
    }

    if (segment.type === 'face') {
      return `表情:${segment.data.id} `;
    }

    if (segment.type === 'image') {
      const alt = basename(segment.data.file, 'image');
      if (isHttpUrl(segment.data.url)) {
        return asOwnLine(`![${escapeMarkdownLabel(alt)}](${segment.data.url})`);
      }
      return asOwnLine(`图片:${alt}`);
    }

    if (segment.type === 'file') {
      const label = basename(segment.data.file, 'file');
      if (isHttpUrl(segment.data.file)) {
        return asOwnLine(toMarkdownLink(label, segment.data.file));
      }
      return asOwnLine(`附件:${label}`);
    }

    if (segment.type === 'video') {
      const label = basename(segment.data.file, 'video');
      const url = isHttpUrl(segment.data.url)
        ? segment.data.url
        : isHttpUrl(segment.data.file)
          ? segment.data.file
          : undefined;
      if (url) {
        return asOwnLine(toMarkdownLink(label, url));
      }
      return asOwnLine(`视频:${label}`);
    }

    if (segment.type === 'record') {
      const label = basename(segment.data.file, 'audio');
      if (isHttpUrl(segment.data.file)) {
        return asOwnLine(toMarkdownLink(label, segment.data.file));
      }
      return asOwnLine(`音频:${label}`);
    }

    if (segment.type === 'reply') {
      return toReplyPlaceholder(segment.data.id);
    }

    if (segment.type === 'forward') {
      const data = segment.data as { id: string; content?: QQRawMessage[] };
      if (Array.isArray(data.content) && data.content.length > 0) {
        try {
          const expanded = data.content
            .map((raw) => {
              const authorName = raw.sender.card || raw.sender.nickname || String(raw.user_id);
              const authorId = String(raw.user_id);
              const bodyMarkdown = this.parseIncomingSync(raw).markdown;
              return toReplyQuoteMarkdown(authorName, authorId, bodyMarkdown);
            })
            .join('');

          return expanded.trim().length > 0 ? expanded : toForwardPlaceholder(data.id);
        } catch {
          // ignore error for now
        }
      }

      return toForwardPlaceholder(segment.data.id);
    }

    if (segment.type === 'markdown') {
      return segment.data.content;
    }

    return '';
  }

  private finalizeParsedMessage(
    raw: QQRawMessage,
    segments: QQMessageSegment[],
    markdownParts: string[],
    attachments: Attachment[]
  ): QQParsedIncomingMessage {
    const fromSegments = markdownParts.join('').trim();
    const markdown =
      fromSegments || (segments.length === 0 && raw.raw_message ? raw.raw_message : '');
    const formatted = this.toAst(markdown);

    return {
      markdown,
      formatted,
      text: toPlainTextPreserveBreaks(formatted),
      attachments
    };
  }
}
