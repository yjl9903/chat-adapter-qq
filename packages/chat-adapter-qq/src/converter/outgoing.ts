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

import { isHttpUrl } from './utils.js';
import { extractMedia, toFileSegments } from './file.js';
import { isQQAtNode, isQQForwardNode, isQQReplyNode } from './ast.js';

// ---------------------------------------------------------------------------
// AST → SendMessageSegment[] conversion
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Parse `@\d+` mentions in a text value into text + at segments. */
function pushTextWithMentions(builder: SegmentBuilder, value: string): void {
  const AT_PATTERN = /@(\d+)/g;

  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = AT_PATTERN.exec(value)) !== null) {
    if (match.index > lastIndex) {
      builder.pushText(value.slice(lastIndex, match.index));
    }
    builder.pushSegment(Structs.at(match[1]));
    lastIndex = AT_PATTERN.lastIndex;
  }

  if (lastIndex < value.length) {
    builder.pushText(value.slice(lastIndex));
  }
}

/** Convert an inline AST node to segments. */
function visitInlineNode(builder: SegmentBuilder, node: AnyNode): void {
  if (isQQAtNode(node)) {
    builder.pushSegment(Structs.at(node.data.id));
    return;
  }

  if (node.type === 'text') {
    pushTextWithMentions(builder, node.value);
    return;
  }

  if (node.type === 'inlineCode') {
    builder.pushText(node.value);
    return;
  }

  if (node.type === 'image') {
    if (isHttpUrl(node.url)) {
      builder.pushSegment(Structs.image(node.url));
    } else {
      builder.pushText(node.alt ?? '');
    }
    return;
  }

  if (node.type === 'link') {
    const label = (node.children as AnyNode[])
      .map((child: AnyNode) => (child.type === 'text' ? child.value : ''))
      .join('');
    builder.pushText(label && label !== node.url ? `${label} (${node.url})` : node.url);
    return;
  }

  if (node.type === 'break') {
    builder.pushText('\n');
    return;
  }

  if (hasChildren(node)) {
    for (const child of node.children) {
      visitInlineNode(builder, child);
    }
    return;
  }
}

/** Convert a block-level AST node to segments. */
function visitBlockNode(builder: SegmentBuilder, node: AnyNode): void {
  // Reply/forward are only valid as normalized top-level nodes.
  if (isQQReplyNode(node) || isQQForwardNode(node)) {
    return;
  }

  if (isQQAtNode(node)) {
    builder.pushSegment(Structs.at(node.data.id));
    return;
  }

  if (node.type === 'code') {
    builder.pushText(node.value);
    return;
  }

  if (node.type === 'blockquote') {
    for (const child of node.children) {
      visitBlockNode(builder, child);
    }
    return;
  }

  if (node.type === 'list') {
    for (const item of node.children) {
      builder.pushText('- ');
      visitBlockNode(builder, item);
      builder.pushText('\n');
    }
    return;
  }

  if (node.type === 'listItem') {
    for (const child of node.children) {
      visitBlockNode(builder, child);
    }
    return;
  }

  if (node.type === 'table') {
    for (const row of node.children) {
      const cells: string[] = [];
      for (const cell of row.children) {
        cells.push(
          (cell.children as AnyNode[])
            .map((c: AnyNode) => (c.type === 'text' ? c.value : ''))
            .join('')
        );
      }
      builder.pushText(cells.join(' | '));
      builder.pushText('\n');
    }
    return;
  }

  // Paragraph and other inline containers.
  if (hasChildren(node)) {
    for (const child of node.children) {
      visitInlineNode(builder, child);
    }
    return;
  }
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

function visitTopLevelNode(builder: SegmentBuilder, node: AnyNode): void {
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

  visitBlockNode(builder, node);
}

/** Walk a Root AST and produce NapCat message segments. */
function astToSegments(root: Root): SegmentBuilder {
  const builder = new SegmentBuilder();
  const { children, hasLeadingReply } = normalizeRootChildren(root);
  let hasRenderedTopLevelNode = false;
  let previousWasLeadingReply = false;

  for (const child of children) {
    if (hasRenderedTopLevelNode && !previousWasLeadingReply) {
      builder.pushText('\n');
    }

    visitTopLevelNode(builder, child);
    hasRenderedTopLevelNode = true;
    previousWasLeadingReply = hasLeadingReply && isQQReplyNode(child);
  }

  return builder.build();
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

/**
 * Parse an AdapterPostableMessage to an AST.
 *
 * Raw messages return `null` — they bypass the AST pipeline entirely.
 */
function messageToAst(message: AdapterPostableMessage): Root | null {
  if (typeof message === 'string') {
    return parseMarkdown(message);
  }

  if (isCardElement(message)) {
    return parseMarkdown(cardToFallbackText(message as CardElement));
  }

  if ('raw' in message) {
    return null;
  }

  if ('markdown' in message) {
    return parseMarkdown(message.markdown);
  }

  if ('ast' in message) {
    return structuredClone(message.ast);
  }

  if ('card' in message) {
    const text = message.fallbackText || cardToFallbackText(message.card);
    return parseMarkdown(text);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an AdapterPostableMessage into NapCat outgoing segments.
 *
 * 1. Parse input to AST (raw messages bypass the AST pipeline).
 * 2. Walk AST to produce segments — images become `Structs.image`,
 *    `@\d+` mentions and custom At nodes become `Structs.at`, custom
 *    Reply/Forward nodes become `Structs.reply`/`Structs.forward`,
 *    everything else becomes text.
 * 3. Append file upload / attachment segments.
 */
export async function renderOutgoingSegments(
  message: AdapterPostableMessage,
  logger?: Logger
): Promise<SegmentBuilder> {
  const ast = messageToAst(message);

  let builder: SegmentBuilder;
  if (ast) {
    builder = astToSegments(ast);
  } else {
    // Raw message — parse @mentions from text, pass through otherwise.
    const raw = (message as { raw: string }).raw;
    builder = new SegmentBuilder();
    pushTextWithMentions(builder, raw);
  }

  const { files, attachments } = extractMedia(message);
  const fileSegments = await toFileSegments(files, attachments, logger);
  if (builder.hasForwardMessageBatch()) {
    if (fileSegments.length > 0) {
      logger?.warn('Forward batches ignore file and attachment segments');
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
