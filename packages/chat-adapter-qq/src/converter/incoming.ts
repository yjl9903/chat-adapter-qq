import type { Attachment, Root } from 'chat';
import type { Receive } from 'node-napcat-ts';

import type { QQNapcatClient, QQRawMessage } from '../types.js';
import type { QQFormatConverter } from './index.js';

import { formatQQMentionToken, formatQQPlainMentionText } from './mention.js';
import { toPlainTextPreserveBreaks } from './to-plain-text.js';
import { isHttpUrl, parseSize, basename } from './utils.js';

/** NapCat 入站 message segment 的联合类型。 */
export type QQMessageSegment = Receive[keyof Receive];

export interface QQParsedIncomingMessage {
  markdown: string;
  formatted: Root;
  text: string;
  attachments: Attachment[];
}

export interface QQIncomingMessageParserOptions {
  client?: QQNapcatClient;
  converter: QQFormatConverter;
  toAst: (platformText: string) => Root;
}

export interface QQIncomingParseOptions {
  plainMentionText: boolean;
}

interface QQPreparedIncomingSegments {
  activeSegments: QQMessageSegment[];
  attachments: Attachment[];
  standaloneForwardId?: string;
}

const FILTERED_SEGMENT_TYPES = new Set(['rps', 'poke', 'shake']);

function isFilteredSegment(segment: QQMessageSegment): boolean {
  return FILTERED_SEGMENT_TYPES.has(segment.type);
}

function hasInlineForwardContent(segment: QQMessageSegment): boolean {
  if (segment.type !== 'forward') {
    return false;
  }

  const data = segment.data as { content?: QQRawMessage[] };
  return Array.isArray(data.content) && data.content.length > 0;
}

function getStandaloneForwardStub(raw: QQRawMessage): { id: string } | null {
  const activeSegments = raw.message.filter((segment) => !isFilteredSegment(segment));
  if (activeSegments.length !== 1) {
    return null;
  }

  const [segment] = activeSegments;
  if (segment.type !== 'forward' || hasInlineForwardContent(segment)) {
    return null;
  }

  return { id: segment.data.id };
}

function getInlineMentionLabel(segment: QQMessageSegment): string | undefined {
  if (segment.type !== 'at') {
    return undefined;
  }

  const data = segment.data as {
    name?: string;
    text?: string;
    nickname?: string;
  };

  return [data.name, data.text, data.nickname].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
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

function getSenderDisplayLabel(raw: QQRawMessage): string | null {
  return raw.sender.card || raw.sender.nickname || null;
}

function formatIncomingMention(
  userId: string,
  label: string | null | undefined,
  options: QQIncomingParseOptions
): string {
  return options.plainMentionText
    ? formatQQPlainMentionText(userId, label)
    : formatQQMentionToken(userId, label);
}

function toReplyQuoteMarkdown(
  authorName: string,
  authorId: string,
  messageBodyMarkdown: string,
  options: QQIncomingParseOptions
): string {
  const normalizedAuthor = authorName.trim() || '未知发送人';
  const header = `${formatIncomingMention(authorId, normalizedAuthor, options)}:`;
  const normalizedBody = messageBodyMarkdown.replace(/\r\n?/g, '\n');
  const rawLines = normalizedBody.split('\n').map((line) => line.trimEnd());

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
      size,
      qq: {
        kind: 'image',
        file: segment.data.file
      }
    };
  }

  if (segment.type === 'file') {
    return {
      type: 'file',
      name: basename(segment.data.file, 'file'),
      size: parseSize(segment.data.file_size),
      qq: {
        kind: 'file',
        file: segment.data.file,
        fileId: segment.data.file_id
      }
    };
  }

  if (segment.type === 'video') {
    return {
      type: 'video',
      name: basename(segment.data.file, 'video'),
      url: segment.data.url,
      size: parseSize(segment.data.file_size),
      qq: {
        kind: 'video',
        file: segment.data.file
      }
    };
  }

  if (segment.type === 'record') {
    return {
      type: 'audio',
      name: basename(segment.data.file, 'audio'),
      size: parseSize(segment.data.file_size),
      qq: {
        kind: 'record',
        file: segment.data.file
      }
    };
  }

  return null;
}

function prepareIncomingSegments(raw: QQRawMessage): QQPreparedIncomingSegments {
  const activeSegments: QQMessageSegment[] = [];
  const attachments: Attachment[] = [];

  for (const segment of raw.message) {
    if (isFilteredSegment(segment)) {
      continue;
    }

    activeSegments.push(segment);

    const attachment = attachmentFromSegment(segment);
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const standaloneForward = activeSegments.length === 1 ? activeSegments[0] : null;

  return {
    activeSegments,
    attachments,
    standaloneForwardId:
      standaloneForward?.type === 'forward' && !hasInlineForwardContent(standaloneForward)
        ? standaloneForward.data.id
        : undefined
  };
}

export class QQIncomingMessageParser {
  private readonly client?: QQNapcatClient;
  private readonly converter: QQFormatConverter;
  private readonly toAst: (platformText: string) => Root;

  public constructor(options: QQIncomingMessageParserOptions) {
    this.client = options.client;
    this.converter = options.converter;
    this.toAst = options.toAst;
  }

  public parseSync(raw: QQRawMessage, options: QQIncomingParseOptions): QQParsedIncomingMessage {
    const { activeSegments, attachments } = prepareIncomingSegments(raw);
    const markdownParts = activeSegments.map((segment) =>
      this.renderSegmentSync(raw, segment, options)
    );

    return this.finalizeParsedMessage(raw, markdownParts, attachments);
  }

  public async parse(
    raw: QQRawMessage,
    options: QQIncomingParseOptions
  ): Promise<QQParsedIncomingMessage> {
    const { activeSegments, attachments, standaloneForwardId } = prepareIncomingSegments(raw);

    if (standaloneForwardId) {
      const markdown = await this.fetchForwardMessage(raw.message_id, standaloneForwardId, options);
      return this.finalizeParsedMessage(raw, markdown ? [markdown] : [], attachments);
    }

    const markdownParts = await Promise.all(
      activeSegments.map((segment, index) =>
        index === 0 && segment.type === 'reply'
          ? this.fetchReplyMessage(segment.data.id, options)
          : this.renderSegmentAsync(raw, segment, options)
      )
    );

    return this.finalizeParsedMessage(raw, markdownParts, attachments);
  }

  private getMentionFallbackLabel(raw: QQRawMessage, segment: QQMessageSegment): string | null {
    if (segment.type !== 'at') {
      return null;
    }

    const inlineLabel = getInlineMentionLabel(segment);
    if (inlineLabel) {
      return inlineLabel;
    }

    return String(raw.user_id) === String(segment.data.qq) ? getSenderDisplayLabel(raw) : null;
  }

  private async resolveMentionLabel(
    raw: QQRawMessage,
    segment: QQMessageSegment
  ): Promise<string | null> {
    if (segment.type !== 'at' || segment.data.qq === 'all') {
      return null;
    }

    return this.converter.resolveMentionLabel(
      raw,
      String(segment.data.qq),
      this.getMentionFallbackLabel(raw, segment)
    );
  }

  private renderQuotedMessageSync(
    raw: QQRawMessage,
    options: QQIncomingParseOptions
  ): string | null {
    const bodyMarkdown = this.parseSync(raw, options).markdown;
    if (!bodyMarkdown.trim()) {
      return null;
    }

    const authorId = String(raw.user_id);
    return toReplyQuoteMarkdown(
      getSenderDisplayLabel(raw) ?? authorId,
      authorId,
      bodyMarkdown,
      options
    );
  }

  private async renderQuotedMessage(
    raw: QQRawMessage,
    options: QQIncomingParseOptions
  ): Promise<string | null> {
    const bodyMarkdown = (await this.parse(raw, options)).markdown;
    if (!bodyMarkdown.trim()) {
      return null;
    }

    const authorId = String(raw.user_id);
    const authorName =
      (await this.converter.resolveMentionLabel(raw, authorId, getSenderDisplayLabel(raw))) ??
      authorId;

    return toReplyQuoteMarkdown(authorName, authorId, bodyMarkdown, options);
  }

  private renderForwardContentSync(
    content: QQRawMessage[],
    options: QQIncomingParseOptions
  ): string | null {
    try {
      const expanded = content
        .map((forwardedRaw) => this.renderQuotedMessageSync(forwardedRaw, options) ?? '')
        .join('');

      return expanded.trim().length > 0 ? expanded : null;
    } catch {
      return null;
    }
  }

  private async renderForwardContent(
    content: QQRawMessage[],
    options: QQIncomingParseOptions
  ): Promise<string | null> {
    try {
      const expanded = (
        await Promise.all(
          content.map(
            async (forwardedRaw) => (await this.renderQuotedMessage(forwardedRaw, options)) ?? ''
          )
        )
      ).join('');

      return expanded.trim().length > 0 ? expanded : null;
    } catch {
      return null;
    }
  }

  private async fetchReplyMessage(
    messageId: string,
    options: QQIncomingParseOptions
  ): Promise<string> {
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
      return (
        (await this.renderQuotedMessage(replyMessage, options)) ?? toReplyPlaceholder(messageId)
      );
    } catch {
      return toReplyPlaceholder(messageId);
    }
  }

  private async fetchForwardMessage(
    messageId: number,
    forwardId: string,
    options: QQIncomingParseOptions
  ): Promise<string> {
    const client = this.client;
    if (!client) {
      return toForwardPlaceholder(forwardId);
    }

    try {
      const expandedMessage = await client.get_msg({
        message_id: messageId
      });

      if (expandedMessage.message_id === messageId && getStandaloneForwardStub(expandedMessage)) {
        return toForwardPlaceholder(forwardId);
      }

      const expandedMarkdown = (await this.parse(expandedMessage, options)).markdown;

      if (!expandedMarkdown.trim()) {
        return toForwardPlaceholder(forwardId);
      }

      return expandedMarkdown;
    } catch {
      return toForwardPlaceholder(forwardId);
    }
  }

  private async renderSegmentAsync(
    raw: QQRawMessage,
    segment: QQMessageSegment,
    options: QQIncomingParseOptions
  ): Promise<string> {
    if (segment.type === 'at') {
      return this.renderAtSegment(segment, await this.resolveMentionLabel(raw, segment), options);
    }

    if (segment.type === 'forward') {
      const data = segment.data as { id: string; content?: QQRawMessage[] };
      if (Array.isArray(data.content) && data.content.length > 0) {
        return (
          (await this.renderForwardContent(data.content, options)) ?? toForwardPlaceholder(data.id)
        );
      }
    }

    return this.renderSegmentSync(raw, segment, options);
  }

  private renderAtSegment(
    segment: Extract<QQMessageSegment, { type: 'at' }>,
    mentionLabel: string | null | undefined,
    options: QQIncomingParseOptions
  ): string {
    if (segment.data.qq === 'all') {
      return '@所有人 ';
    }

    const label = mentionLabel ?? getInlineMentionLabel(segment);
    return `${formatIncomingMention(String(segment.data.qq), label, options)} `;
  }

  private renderSegmentSync(
    raw: QQRawMessage,
    segment: QQMessageSegment,
    options: QQIncomingParseOptions
  ): string {
    if (segment.type === 'text') {
      return segment.data.text;
    }

    if (segment.type === 'at') {
      return this.renderAtSegment(segment, this.getMentionFallbackLabel(raw, segment), options);
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
        return (
          this.renderForwardContentSync(data.content, options) ?? toForwardPlaceholder(data.id)
        );
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
    markdownParts: string[],
    attachments: Attachment[]
  ): QQParsedIncomingMessage {
    const markdown =
      markdownParts
        .filter((part) => part.length > 0)
        .join('')
        .trim() || (raw.message.length === 0 && raw.raw_message ? raw.raw_message : '');
    const formatted = this.toAst(markdown);

    return {
      markdown,
      formatted,
      text: toPlainTextPreserveBreaks(formatted),
      attachments
    };
  }
}
