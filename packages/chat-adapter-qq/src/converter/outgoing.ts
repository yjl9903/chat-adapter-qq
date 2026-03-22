import {
  type AdapterPostableMessage,
  type CardElement,
  type Logger,
  type Root,
  cardChildToFallbackText,
  isCardElement,
  parseMarkdown
} from 'chat';
import { type NodeSegment, type SendMessageSegment, Structs } from 'node-napcat-ts';

import type { QQChatType } from '../types.js';

import type { QQFormatConverter } from './index.js';

import { isHttpUrl } from './utils.js';
import { extractMedia, toFileSegments } from './file.js';
import {
  extractQQMentionTokenLabel,
  formatQQPlainMentionText,
  parseQQMentionToken
} from './mention.js';
import { forward, reply, isQQAtNode, isQQForwardNode, isQQReplyNode } from './ast.js';

// ---------------------------------------------------------------------------
// AST → SendMessageSegment[] conversion
// ---------------------------------------------------------------------------

type AnyNode = any;

/**
 * Collects outgoing segments from an AST.
 *
 * Accumulates plain text in a buffer. When a non-text segment is encountered
 * (image, at, reply, forward), the buffer is flushed as a Structs.text first.
 */
export class SegmentBuilder extends Array<SendMessageSegment> {
  private textBuffer = '';

  private forwardMessageIds: string[] | null = [];

  /** Append plain text to the buffer. */
  public pushText(value: string): void {
    this.textBuffer += value;
  }

  /** Flush the text buffer (if non-empty) and push a non-text segment. */
  public pushSegment(segment: SendMessageSegment): void {
    this.flush();
    super.push(segment);
  }

  /** Flush buffered text and append multiple non-text segments. */
  public pushSegments(segments: SendMessageSegment[]): void {
    if (segments.length === 0) return;
    this.flush();
    super.push(...segments);
  }

  /** Record a multi-message forward payload for adapter-side send_forward_msg. */
  public setForwardMessageIds(messageIds: string[]): void {
    this.forwardMessageIds = [...messageIds];
  }

  public getForwardMessageIds(): readonly string[] | null {
    return this.forwardMessageIds;
  }

  public hasForwardMessageBatch(): boolean {
    return (this.forwardMessageIds?.length ?? 0) > 1;
  }

  public toForwardNodeSegments(): NodeSegment[] | null {
    if (!this.hasForwardMessageBatch() || !this.forwardMessageIds) {
      return null;
    }

    return this.forwardMessageIds.map((messageId) => {
      const node = Structs.node(messageId);
      return {
        type: node.type,
        data: { id: messageId }
      };
    });
  }

  /** Flush remaining text and return all segments. */
  public build(): this {
    this.flush();
    return this;
  }

  private flush(): void {
    if (this.textBuffer.length > 0) {
      super.push(Structs.text(this.textBuffer));
      this.textBuffer = '';
    }
  }

  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}

function hasChildren(node: AnyNode): node is AnyNode & { children: AnyNode[] } {
  return 'children' in node && Array.isArray(node.children);
}

function textChildrenToString(children: AnyNode[]): string {
  return children.map((child) => (child.type === 'text' ? child.value : '')).join('');
}

function normalizeRootChildren(root: Root): { children: AnyNode[]; hasLeadingReply: boolean } {
  const hasLeadingReply = isQQReplyNode(root.children[0]);
  const hasStandaloneForward = root.children.length === 1 && isQQForwardNode(root.children[0]);

  if (hasStandaloneForward) {
    return { children: [root.children[0]], hasLeadingReply: false };
  }

  return {
    children: root.children.filter((child, index) => {
      if (isQQForwardNode(child)) return false;
      if (isQQReplyNode(child)) return hasLeadingReply && index === 0;
      return true;
    }),
    hasLeadingReply
  };
}

function normalizeReplyId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeForwardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.map((id) => (typeof id === 'string' ? id : '')).filter((id) => id.length > 0);
}

function getOutgoingMessageMetadata(message: AdapterPostableMessage): {
  replyId?: string;
  forwardIds: string[];
} {
  if (typeof message === 'string' || isCardElement(message) || 'raw' in message) {
    return { forwardIds: [] };
  }

  return {
    replyId: normalizeReplyId(message.reply),
    forwardIds: normalizeForwardIds(message.forward)
  };
}

function applyOutgoingMessageMetadata(
  root: Root,
  message: AdapterPostableMessage,
  logger?: Logger
): Root {
  const { replyId, forwardIds } = getOutgoingMessageMetadata(message);
  if (forwardIds.length > 0) {
    if (replyId || root.children.length > 0) {
      logger?.warn('Forward metadata ignores reply and body content');
    }

    return {
      ...root,
      children: [forward(...forwardIds)]
    };
  }

  if (!replyId) {
    return root;
  }

  return {
    ...root,
    children: [reply(replyId), ...root.children]
  };
}

// ---------------------------------------------------------------------------
// Message → AST
// ---------------------------------------------------------------------------

function cardToFallbackText(card: CardElement): string {
  const parts: string[] = [];
  if (card.title) parts.push(card.title);
  if (card.subtitle) parts.push(card.subtitle);
  for (const child of card.children) {
    const text = cardChildToFallbackText(child);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

export interface QQOutgoingMessageRendererOptions {
  converter: QQFormatConverter;
  logger?: Logger;
  toAst?: (platformText: string) => Root;
}

export interface QQOutgoingRenderOptions {
  chatType: QQChatType;
  peerId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class QQOutgoingMessageRenderer {
  private readonly converter: QQFormatConverter;
  private readonly logger?: Logger;
  private readonly toAst: (platformText: string) => Root;

  public constructor(options: QQOutgoingMessageRendererOptions) {
    this.converter = options.converter;
    this.logger = options.logger;
    this.toAst = options.toAst ?? parseMarkdown;
  }

  /**
   * Render an AdapterPostableMessage into NapCat outgoing segments.
   *
   * 1. Parse input to AST (raw messages bypass the AST pipeline).
   * 2. Walk AST to produce segments — images become `Structs.image`,
   *    `@\d+` / `@name{qq:id}` mentions and custom At nodes become `Structs.at`, custom
   *    Reply/Forward nodes become `Structs.reply`/`Structs.forward`,
   *    everything else becomes text.
   * 3. Append file upload / attachment segments.
   */
  public async render(
    message: AdapterPostableMessage,
    options: QQOutgoingRenderOptions
  ): Promise<SegmentBuilder> {
    const ast = this.messageToAst(message);

    let builder: SegmentBuilder;
    if (ast) {
      builder = await this.astToSegments(ast, options);
    } else {
      const raw = (message as { raw: string }).raw;
      builder = new SegmentBuilder();
      await this.pushTextWithMentions(builder, raw, options);
    }

    const { files, attachments } = extractMedia(message);
    const fileSegments = await toFileSegments(files, attachments, this.logger);
    if (builder.hasForwardMessageBatch()) {
      if (fileSegments.length > 0) {
        this.logger?.warn('Forward batches ignore file and attachment segments');
      }
      return builder.build();
    }

    builder.pushSegments(fileSegments);
    builder.build();
    if (builder.length === 0) {
      builder.pushSegment(Structs.text(' '));
    }

    return builder.build();
  }

  private async pushMention(
    builder: SegmentBuilder,
    userId: string,
    options: QQOutgoingRenderOptions,
    fallbackLabel?: string | null
  ): Promise<void> {
    if (options.chatType !== 'private') {
      builder.pushSegment(Structs.at(userId));
      return;
    }

    builder.pushText(
      formatQQPlainMentionText(
        userId,
        await this.converter.resolveMentionLabel(options, userId, fallbackLabel)
      )
    );
  }

  /** Parse mention tokens in a text value into text + at segments. */
  private async pushTextWithMentions(
    builder: SegmentBuilder,
    value: string,
    options: QQOutgoingRenderOptions
  ): Promise<void> {
    let lastIndex = 0;
    let index = 0;

    while (index < value.length) {
      const mention = value[index] === '@' ? parseQQMentionToken(value, index) : null;
      if (!mention) {
        index += 1;
        continue;
      }

      if (index > lastIndex) {
        builder.pushText(value.slice(lastIndex, index));
      }

      await this.pushMention(
        builder,
        mention.id,
        options,
        extractQQMentionTokenLabel(value, index, mention.end, mention.id)
      );

      index = mention.end;
      lastIndex = mention.end;
    }

    if (lastIndex < value.length) {
      builder.pushText(value.slice(lastIndex));
    }
  }

  /** Convert an inline AST node to segments. */
  private async visitInlineNode(
    builder: SegmentBuilder,
    node: AnyNode,
    options: QQOutgoingRenderOptions
  ): Promise<void> {
    if (isQQAtNode(node)) {
      await this.pushMention(builder, node.data.id, options, node.data.name);
      return;
    }

    switch (node.type) {
      case 'text':
        await this.pushTextWithMentions(builder, node.value, options);
        return;
      case 'inlineCode':
        builder.pushText(node.value);
        return;
      case 'image':
        if (isHttpUrl(node.url)) {
          builder.pushSegment(Structs.image(node.url));
        } else {
          builder.pushText(node.alt ?? '');
        }
        return;
      case 'link': {
        const label = textChildrenToString(node.children as AnyNode[]);
        builder.pushText(label && label !== node.url ? `${label} (${node.url})` : node.url);
        return;
      }
      case 'break':
        builder.pushText('\n');
        return;
      default:
        if (hasChildren(node)) {
          for (const child of node.children) {
            await this.visitInlineNode(builder, child, options);
          }
        }
    }
  }

  /** Convert a block-level AST node to segments. */
  private async visitBlockNode(
    builder: SegmentBuilder,
    node: AnyNode,
    options: QQOutgoingRenderOptions
  ): Promise<void> {
    if (isQQReplyNode(node) || isQQForwardNode(node)) {
      return;
    }

    if (isQQAtNode(node)) {
      await this.pushMention(builder, node.data.id, options, node.data.name);
      return;
    }

    switch (node.type) {
      case 'code':
        builder.pushText(node.value);
        return;
      case 'blockquote':
        for (const child of node.children) {
          await this.visitBlockNode(builder, child, options);
        }
        return;
      case 'list':
        for (const item of node.children) {
          builder.pushText('- ');
          await this.visitBlockNode(builder, item, options);
          builder.pushText('\n');
        }
        return;
      case 'listItem':
        for (const child of node.children) {
          await this.visitBlockNode(builder, child, options);
        }
        return;
      case 'table':
        for (const row of node.children) {
          const cells = row.children.map((cell: AnyNode) =>
            textChildrenToString(cell.children as AnyNode[])
          );
          builder.pushText(cells.join(' | '));
          builder.pushText('\n');
        }
        return;
      default:
        if (hasChildren(node)) {
          for (const child of node.children) {
            await this.visitInlineNode(builder, child, options);
          }
        }
    }
  }

  private async visitTopLevelNode(
    builder: SegmentBuilder,
    node: AnyNode,
    options: QQOutgoingRenderOptions
  ): Promise<void> {
    if (isQQReplyNode(node)) {
      builder.pushSegment(Structs.reply(node.data.id));
      return;
    }

    if (isQQForwardNode(node)) {
      if (node.data.ids.length === 1) {
        builder.pushSegment(Structs.forward(Number(node.data.ids[0])));
      } else if (node.data.ids.length > 1) {
        builder.setForwardMessageIds(node.data.ids);
      }
      return;
    }

    await this.visitBlockNode(builder, node, options);
  }

  /** Walk a Root AST and produce NapCat message segments. */
  private async astToSegments(
    root: Root,
    options: QQOutgoingRenderOptions
  ): Promise<SegmentBuilder> {
    const builder = new SegmentBuilder();
    const { children, hasLeadingReply } = normalizeRootChildren(root);
    let hasRenderedTopLevelNode = false;
    let previousWasLeadingReply = false;

    for (const child of children) {
      if (hasRenderedTopLevelNode && !previousWasLeadingReply) {
        builder.pushText('\n');
      }

      await this.visitTopLevelNode(builder, child, options);
      hasRenderedTopLevelNode = true;
      previousWasLeadingReply = hasLeadingReply && isQQReplyNode(child);
    }

    return builder.build();
  }

  /**
   * Parse an AdapterPostableMessage to an AST.
   *
   * Raw messages return `null` — they bypass the AST pipeline entirely.
   */
  private messageToAst(message: AdapterPostableMessage): Root | null {
    if (typeof message === 'string') {
      return this.toAst(message);
    }

    if (isCardElement(message)) {
      return this.toAst(cardToFallbackText(message as CardElement));
    }

    if ('raw' in message) {
      return null;
    }

    if ('markdown' in message) {
      return applyOutgoingMessageMetadata(this.toAst(message.markdown), message, this.logger);
    }

    if ('ast' in message) {
      return applyOutgoingMessageMetadata(structuredClone(message.ast), message, this.logger);
    }

    if ('card' in message) {
      const text = message.fallbackText || cardToFallbackText(message.card);
      return applyOutgoingMessageMetadata(this.toAst(text), message, this.logger);
    }

    return null;
  }
}
