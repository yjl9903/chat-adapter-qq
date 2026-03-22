import {
  type AdapterPostableMessage,
  type Root,
  type Logger,
  BaseFormatConverter,
  parseMarkdown,
  stringifyMarkdown
} from 'chat';

import type { QQNapcatClient, QQRawMessage, QQThreadId } from '../types.js';
import { toThreadId } from '../utils.js';

import {
  type QQIncomingParseOptions,
  type QQParsedIncomingMessage,
  QQIncomingMessageParser
} from './incoming.js';
import {
  type QQOutgoingRenderOptions,
  type SegmentBuilder,
  QQOutgoingMessageRenderer
} from './outgoing.js';

export type { QQMessageSegment, QQParsedIncomingMessage } from './incoming.js';

function normalizeMentionLabel(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function toPositiveInteger(value: string): number | null {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

export class QQFormatConverter extends BaseFormatConverter {
  private readonly client?: QQNapcatClient;

  private readonly parser: QQIncomingMessageParser;

  private readonly renderer: QQOutgoingMessageRenderer;

  private readonly pendingMentionLabelLookups = new Map<string, Promise<string | null>>();

  public constructor(client?: QQNapcatClient, logger?: Logger) {
    super();
    this.client = client;

    this.parser = new QQIncomingMessageParser({
      client,
      converter: this,
      toAst: (platformText) => this.toAst(platformText)
    });

    this.renderer = new QQOutgoingMessageRenderer({
      converter: this,
      logger,
      toAst: (platformText) => this.toAst(platformText)
    });
  }

  public toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  public fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  public parseIncomingSync(
    raw: QQRawMessage,
    options: QQIncomingParseOptions
  ): QQParsedIncomingMessage {
    return this.parser.parseSync(raw, options);
  }

  /** 将 NapCat raw message 转为 markdown / ast / text / attachments。 */
  public async parseIncoming(
    raw: QQRawMessage,
    options: QQIncomingParseOptions
  ): Promise<QQParsedIncomingMessage> {
    return this.parser.parse(raw, options);
  }

  /** Convert an AdapterPostableMessage to NapCat outgoing segments. */
  public async renderOutgoing(
    message: AdapterPostableMessage,
    options: QQOutgoingRenderOptions
  ): Promise<SegmentBuilder> {
    return this.renderer.render(message, options);
  }

  public resolveMentionLabel(
    target: QQRawMessage,
    userId: string,
    fallbackLabel?: string | null
  ): Promise<string | null>;
  public resolveMentionLabel(
    target: QQThreadId,
    userId: string,
    fallbackLabel?: string | null
  ): Promise<string | null>;
  public async resolveMentionLabel(
    target: QQRawMessage | QQThreadId,
    userId: string,
    fallbackLabel?: string | null
  ): Promise<string | null> {
    const normalizedFallback = (fallbackLabel ?? '').trim();
    if (normalizedFallback) {
      return normalizedFallback;
    }

    return this.lookupMentionLabel(this.getMentionLookupThread(target), userId);
  }

  private getMentionLookupThread(target: QQRawMessage | QQThreadId): QQThreadId {
    return 'peerId' in target ? target : toThreadId(target);
  }

  private async lookupMentionLabel(thread: QQThreadId, userId: string): Promise<string | null> {
    const cacheKey = `${thread.chatType}:${thread.peerId}:${userId}`;
    const cached = this.pendingMentionLabelLookups.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.queryMentionLabel(thread, userId)
      .catch(() => null)
      .finally(() => {
        this.pendingMentionLabelLookups.delete(cacheKey);
      });

    this.pendingMentionLabelLookups.set(cacheKey, promise);
    return promise;
  }

  private async queryMentionLabel(thread: QQThreadId, userId: string): Promise<string | null> {
    const client = this.client;
    if (!client) {
      return null;
    }

    const numericUserId = toPositiveInteger(userId);
    if (numericUserId === null) {
      return null;
    }

    return (
      (await this.fetchGroupMentionLabel(client, thread, numericUserId, userId)) ??
      (await this.fetchLoginMentionLabel(client, numericUserId, userId)) ??
      (await this.fetchFriendMentionLabel(client, numericUserId, userId)) ??
      (await this.fetchStrangerMentionLabel(client, numericUserId, userId))
    );
  }

  private async fetchGroupMentionLabel(
    client: QQNapcatClient,
    thread: QQThreadId,
    numericUserId: number,
    userId: string
  ): Promise<string | null> {
    if (thread.chatType !== 'group') {
      return null;
    }

    const numericPeerId = toPositiveInteger(thread.peerId);
    if (numericPeerId === null) {
      return null;
    }

    try {
      const member = await client.get_group_member_info({
        group_id: numericPeerId,
        user_id: numericUserId
      });
      return normalizeMentionLabel(member.card, member.nickname) ?? userId;
    } catch {
      return null;
    }
  }

  private async fetchLoginMentionLabel(
    client: QQNapcatClient,
    numericUserId: number,
    userId: string
  ): Promise<string | null> {
    try {
      const login = await client.get_login_info();
      if (login.user_id !== numericUserId) {
        return null;
      }

      return normalizeMentionLabel(login.nickname) ?? userId;
    } catch {
      return null;
    }
  }

  private async fetchFriendMentionLabel(
    client: QQNapcatClient,
    numericUserId: number,
    userId: string
  ): Promise<string | null> {
    try {
      const friends = await client.get_friend_list();
      const friend = friends.find((item) => item.user_id === numericUserId);
      if (!friend) {
        return null;
      }

      return normalizeMentionLabel(friend.remark, friend.nickname) ?? userId;
    } catch {
      return null;
    }
  }

  private async fetchStrangerMentionLabel(
    client: QQNapcatClient,
    numericUserId: number,
    userId: string
  ): Promise<string | null> {
    try {
      const stranger = await client.get_stranger_info({ user_id: numericUserId });
      return normalizeMentionLabel(stranger.remark, stranger.nickname, stranger.nick) ?? userId;
    } catch {
      return null;
    }
  }
}
