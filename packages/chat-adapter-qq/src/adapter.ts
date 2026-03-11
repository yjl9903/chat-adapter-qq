import {
  type Adapter,
  type AdapterPostableMessage,
  type Author,
  type ChannelInfo,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type Logger,
  type RawMessage,
  type ThreadInfo,
  type WebhookOptions,
  NotImplementedError,
  Message,
  emoji
} from 'chat';
import { ValidationError } from '@chat-adapter/shared';
import { type SendMessageSegment, Structs } from 'node-napcat-ts';

import type {
  QQAdapterConfig,
  QQEmojiLikeMessage,
  QQFriendInfo,
  QQGroupMessage,
  QQMemberProfile,
  QQNapcatClient,
  QQPrivateMessage,
  QQRawMessage,
  QQThreadId
} from './types.js';

import { QQFormatConverter, type QQParsedIncomingMessage } from './converter/index.js';
import { normalizeQQEmojiId } from './emoji.js';
import { QQNapcatConnectionHeartbeat } from './heartbeat.js';
import { CachedNCWebsocket } from './napcat/cached-client.js';
import {
  isMention,
  isSelfMessage,
  toAuthor,
  toPrivateFriendMemberProfile,
  toGroupMemberProfile,
  toNumberId,
  toPrivatePeerMemberProfile,
  toSelfMemberProfile,
  toThreadId
} from './utils.js';

/**
 * Chat SDK QQ 平台适配器（基于 NapCat WebSocket）。
 *
 * 设计说明：
 * - 入口仅支持 WS 事件推送，不支持 HTTP webhook。
 * - thread 模型采用“会话即 thread”：
 *   - 群：`qq:group:{group_id}`
 *   - 私聊：`qq:private:{user_id}`
 */
export class QQAdapter implements Adapter<QQThreadId, QQRawMessage> {
  /** 适配器名称，作为 Chat SDK 的 adapter key。 */
  readonly name = 'qq';

  /** 机器人用户名（初始化后由登录信息填充）。 */
  userName: string;

  /** 机器人用户标识（初始化后由登录信息填充）。 */
  botUserId?: string;

  // ---

  private readonly config: QQAdapterConfig;

  private chat: ChatInstance | null = null;

  private client?: QQNapcatClient;

  private converter!: QQFormatConverter;

  private selfId?: string;

  private logger: Logger;

  private listenersBound = false;

  private initializing?: Promise<void>;

  private heartbeat?: QQNapcatConnectionHeartbeat;

  /** 创建 QQ 适配器实例（不发起连接）。 */
  public constructor(config: QQAdapterConfig) {
    this.config = config;
    this.userName = '';
    this.converter = new QQFormatConverter();
    this.logger = config.logger ?? {
      child: () => this.logger,
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };
  }

  /**
   * 初始化适配器，建立 NapCat 连接并注册消息监听。
   * 该方法具有幂等性，多次调用会复用同一初始化流程。
   */
  public async initialize(chat: ChatInstance): Promise<void> {
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.doInitialize(chat).catch((error) => {
      this.initializing = undefined;
      throw error;
    });

    return this.initializing;
  }

  public async shutdown(): Promise<void> {
    this.stopHeartbeat();

    if (!this.client) return;

    try {
      this.client.disconnect();
    } catch {}
  }

  private async doInitialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = this.config.logger ?? chat.getLogger(this.name);

    if (!this.client) {
      this.client = new CachedNCWebsocket(
        this.config.napcat,
        this.config.debug ?? false,
        this.config.cache
      );
    }

    this.converter = new QQFormatConverter(this.client);

    this.bindListeners();

    await this.client.connect();

    const login = await this.client.get_login_info();
    this.logger.info('login with', login);

    this.selfId = String(login.user_id);
    this.botUserId = login.nickname;
    this.userName = login.nickname;

    this.startHeartbeat();
  }

  /**
   * 获取已初始化的 NapCat 客户端，否则抛出配置错误。
   */
  public getClient() {
    return this.requireClient();
  }

  /** QQ 适配器为 WS-only 模式，HTTP webhook 入口固定返回 501。 */
  public async handleWebhook(_request: Request, _options?: WebhookOptions): Promise<Response> {
    return new Response('QQ adapter uses NapCat WebSocket ingress only.', {
      status: 501
    });
  }

  /** 编码 thread ID：`qq:{chatType}:{peerId}`。 */
  public encodeThreadId(data: QQThreadId): string {
    if (data.chatType !== 'group' && data.chatType !== 'private') {
      throw new ValidationError('qq', `Unsupported QQ chat type: ${data.chatType}`);
    }

    if (!data.peerId) {
      throw new ValidationError('qq', 'QQ thread peerId is required');
    }

    return `qq:${data.chatType}:${data.peerId}`;
  }

  /** 解码 thread ID 并进行格式校验。 */
  public decodeThreadId(threadId: string): QQThreadId {
    const parts = threadId.split(':');
    if (parts.length !== 3 || parts[0] !== 'qq') {
      throw new ValidationError('qq', `Invalid QQ thread ID: ${threadId}`);
    }

    const chatType = parts[1];
    if (chatType !== 'group' && chatType !== 'private') {
      throw new ValidationError('qq', `Invalid QQ thread type in thread ID: ${threadId}`);
    }

    const peerId = parts[2];
    if (!peerId) {
      throw new ValidationError('qq', `Invalid QQ thread peer ID in thread ID: ${threadId}`);
    }

    return {
      chatType,
      peerId
    };
  }

  /** 当前模型下 channelId 与 threadId 一致。 */
  public channelIdFromThreadId(threadId: string): string {
    this.decodeThreadId(threadId);
    return threadId;
  }

  /** 判断当前 thread 是否为私聊会话。 */
  public isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).chatType === 'private';
  }

  /** 向群或私聊发送消息。 */
  public async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<QQRawMessage>> {
    const client = this.requireClient();
    const parsed = this.decodeThreadId(threadId);
    const peerId = toNumberId(parsed.peerId, 'peerId');

    const text = this.converter.renderPostable(message);
    const outgoingText = text.length > 0 ? text : ' ';
    const segments: SendMessageSegment[] = [Structs.text(outgoingText)];

    this.logger.debug('post message', parsed.chatType, parsed.peerId, segments);

    const sent =
      parsed.chatType === 'group'
        ? await client.send_group_msg({
            group_id: peerId,
            message: segments
          })
        : await client.send_private_msg({
            user_id: peerId,
            message: segments
          });

    return {
      id: String(sent.message_id),
      raw: {
        ...sent,
        threadId,
        chatType: parsed.chatType
      } as unknown as QQRawMessage,
      threadId
    };
  }

  /** QQ 暂不支持编辑消息。 */
  public async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage
  ): Promise<RawMessage<QQRawMessage>> {
    throw new NotImplementedError('QQ adapter does not support message editing.', 'editMessage');
  }

  /** 删除指定消息。 */
  public async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    const client = this.requireClient();
    await client.delete_msg({ message_id: toNumberId(messageId, 'messageId') });
  }

  /** 添加消息表情反应（映射到 NapCat emoji_like）。 */
  public async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const client = this.requireClient();
    this.decodeThreadId(threadId);

    const emojiId = normalizeQQEmojiId(emoji);

    this.logger.debug('send_msg_emoji_like', threadId, messageId, emojiId, true);

    await client.set_msg_emoji_like({
      message_id: toNumberId(messageId, 'messageId'),
      emoji_id: emojiId,
      set: true
    });
  }

  /** 移除消息表情反应（映射到 NapCat emoji_like）。 */
  public async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const client = this.requireClient();
    this.decodeThreadId(threadId);

    const emojiId = normalizeQQEmojiId(emoji);

    this.logger.debug('send_msg_emoji_like', threadId, messageId, emojiId, false);

    await client.set_msg_emoji_like({
      message_id: toNumberId(messageId, 'messageId'),
      emoji_id: emojiId,
      set: false
    });
  }

  /** 拉取会话消息历史（支持 forward/backward）。 */
  public async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<QQRawMessage>> {
    const client = this.requireClient();
    const parsed = this.decodeThreadId(threadId);
    const peerId = toNumberId(parsed.peerId, 'peerId');
    const direction = options?.direction ?? 'backward';

    const limit = options?.limit ?? 50;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ValidationError(
        'qq',
        `QQ fetch limit must be a positive integer: ${String(limit)}`
      );
    }

    let cursorSeq: number | undefined;
    if (options?.cursor !== undefined) {
      cursorSeq = toNumberId(options.cursor, 'cursor');
    }

    const historyParams: {
      message_seq?: number;
      count?: number;
      reverseOrder?: boolean;
    } = {
      // NapCat reverseOrder=true aligns with Chat "backward" page direction.
      count: cursorSeq !== undefined ? limit + 1 : limit,
      reverseOrder: direction === 'backward'
    };
    if (cursorSeq !== undefined) {
      historyParams.message_seq = cursorSeq;
    }

    const result =
      parsed.chatType === 'group'
        ? await client.get_group_msg_history({
            group_id: peerId,
            ...historyParams
          })
        : await client.get_friend_msg_history({
            user_id: peerId,
            ...historyParams
          });

    const candidates = cursorSeq
      ? // NapCat page includes the cursor message itself; drop it for stable pagination.
        result.messages.filter((item) => item.message_seq !== cursorSeq)
      : result.messages;

    const ordered = [...candidates];

    const messages = await Promise.all(ordered.map((raw) => this.parseThreadMessage(raw)));
    if (messages.length === 0) {
      return { messages };
    }

    if (ordered.length < limit) {
      return { messages };
    }

    const cursorSource = direction === 'backward' ? ordered[0] : ordered[ordered.length - 1];
    const nextCursor = String(cursorSource.message_seq);
    if (nextCursor === options?.cursor) {
      return { messages };
    }

    return {
      messages,
      nextCursor
    };
  }

  /** 查询 thread 成员列表（QQ 自定义能力）。 */
  public async fetchThreadMembers(threadId: string): Promise<QQMemberProfile[]> {
    const client = this.requireClient();
    const parsed = this.decodeThreadId(threadId);
    const peerId = toNumberId(parsed.peerId, 'peerId');

    if (parsed.chatType === 'group') {
      const members = await client.get_group_member_list({ group_id: peerId });
      return members.map((member) => toGroupMemberProfile(member, this.selfId));
    }

    return this.fetchPrivateMembers(peerId);
  }

  /** 查询 thread 单个成员（QQ 自定义能力）。 */
  public async fetchThreadMember(
    threadId: string,
    userId: string
  ): Promise<QQMemberProfile | null> {
    const client = this.requireClient();
    const parsed = this.decodeThreadId(threadId);
    const peerId = toNumberId(parsed.peerId, 'peerId');
    const targetUserId = toNumberId(userId, 'userId');

    if (parsed.chatType === 'group') {
      const member = await client.get_group_member_info({
        group_id: peerId,
        user_id: targetUserId
      });
      return toGroupMemberProfile(member, this.selfId);
    }

    const members = await this.fetchPrivateMembers(peerId);
    return members.find((member) => member.userId === String(targetUserId)) ?? null;
  }

  /** 查询 channel 成员列表（QQ 采用会话即 channel 模型，委托到 fetchThreadMembers）。 */
  public async fetchChannelMembers(channelId: string): Promise<QQMemberProfile[]> {
    return this.fetchThreadMembers(channelId);
  }

  /** 查询 channel 单个成员（QQ 采用会话即 channel 模型，委托到 fetchThreadMember）。 */
  public async fetchChannelMember(
    channelId: string,
    userId: string
  ): Promise<QQMemberProfile | null> {
    return this.fetchThreadMember(channelId, userId);
  }

  /** 获取 thread 详细信息（通过 NapCat 查询）。 */
  public async fetchThread(threadId: string): Promise<ThreadInfo> {
    const client = this.requireClient();
    const parsed = this.decodeThreadId(threadId);
    const peerId = toNumberId(parsed.peerId, 'peerId');

    // 群聊
    if (parsed.chatType === 'group') {
      const info = await client.get_group_info({ group_id: peerId });

      return {
        id: threadId,
        channelId: threadId,
        channelName: info.group_name,
        isDM: false,
        metadata: {
          chatType: parsed.chatType,
          peerId: parsed.peerId,
          group: info
        }
      };
    }

    // 好友单聊
    const friend = await this.findFriendById(peerId);
    if (friend) {
      const channelName = friend.remark || friend.nickname || String(peerId);

      return {
        id: threadId,
        channelId: threadId,
        channelName,
        isDM: true,
        metadata: {
          chatType: parsed.chatType,
          peerId: parsed.peerId,
          private: friend,
          source: 'friend_list'
        }
      };
    }

    const profile = await client.get_stranger_info({ user_id: peerId });
    const channelName = profile.remark || profile.nickname || profile.nick || String(peerId);

    return {
      id: threadId,
      channelId: threadId,
      channelName,
      isDM: true,
      metadata: {
        chatType: parsed.chatType,
        peerId: parsed.peerId,
        private: profile,
        source: 'stranger_info'
      }
    };
  }

  /** 获取 channel 信息（QQ 采用会话即 channel 模型，委托到 fetchThread）。 */
  public async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const thread = await this.fetchThread(channelId);
    const metadata = thread.metadata;
    const memberCount = typeof metadata.memberCount === 'number' ? metadata.memberCount : undefined;

    return {
      id: channelId,
      isDM: thread.isDM,
      name: thread.channelName,
      memberCount,
      metadata
    };
  }

  /** 获取 channel 消息（QQ 采用会话即 channel 模型，委托到 fetchMessages）。 */
  public async fetchChannelMessages(
    channelId: string,
    options?: FetchOptions
  ): Promise<FetchResult<QQRawMessage>> {
    return this.fetchMessages(channelId, options);
  }

  /** 根据 messageId 拉取单条消息。 */
  public async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<Message<QQRawMessage> | null> {
    const client = this.requireClient();
    this.decodeThreadId(threadId);

    const raw = await client.get_msg({
      message_id: toNumberId(messageId, 'messageId')
    });

    const rawThreadId = this.encodeThreadId(toThreadId(raw));
    if (rawThreadId !== threadId) {
      return null;
    }

    return this.parseThreadMessage(raw);
  }

  /** 打开与指定用户的私聊会话。 */
  public async openDM(userId: string): Promise<string> {
    const parsedUserId = toNumberId(userId, 'userId');

    return this.encodeThreadId({
      chatType: 'private',
      peerId: String(parsedUserId)
    });
  }

  /** 私聊支持 typing；群聊为 no-op。 */
  public async startTyping(threadId: string, status?: string): Promise<void> {
    const client = this.requireClient();
    const parsed = this.decodeThreadId(threadId);

    if (parsed.chatType !== 'private') {
      this.logger.debug('skip typing for non-private thread', threadId, status);
      return;
    }

    await client.set_input_status({
      user_id: parsed.peerId,
      event_type: 1
    });
  }

  /** 渲染格式化内容到 QQ 文本。 */
  public renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  /** 将 NapCat 原始消息转换为 Chat SDK 标准 Message。 */
  public parseMessage(raw: QQRawMessage): Message<QQRawMessage> {
    return this.toMessage(raw, this.converter.parseIncomingSync(raw), undefined);
  }

  /** 将 NapCat 原始消息转换为 Chat SDK Message，并按线程成员信息修正 author。 */
  public async parseThreadMessage(raw: QQRawMessage): Promise<Message<QQRawMessage>> {
    const parsed = await this.converter.parseIncoming(raw);
    const threadId = this.encodeThreadId(toThreadId(raw));
    const userId = String(raw.user_id);

    const member = await this.fetchThreadMember(threadId, userId).catch(() => null);
    const author: Author | undefined = member
      ? {
          userId: member.userId,
          userName: member.userName,
          fullName: member.cardName || member.userName || member.userId,
          isBot: member.isBot,
          isMe: member.isMe
        }
      : undefined;

    return this.toMessage(raw, parsed, author);
  }

  private toMessage(
    raw: QQRawMessage,
    parsed: QQParsedIncomingMessage,
    author?: Author
  ): Message<QQRawMessage> {
    const threadId = this.encodeThreadId(toThreadId(raw));
    const isMe = this.selfId !== undefined && String(raw.user_id) === this.selfId;

    return new Message<QQRawMessage>({
      id: String(raw.message_id),
      threadId,
      text: parsed.text,
      formatted: parsed.formatted,
      author: author ?? toAuthor(raw, isMe),
      metadata: {
        dateSent: new Date(raw.time * 1000),
        edited: false
      },
      attachments: parsed.attachments,
      raw
    });
  }

  private async fetchPrivateMembers(peerId: number): Promise<QQMemberProfile[]> {
    const client = this.requireClient();
    const login = await client.get_login_info();

    this.selfId = String(login.user_id);

    const selfMember = toSelfMemberProfile(login);
    const friend = await this.findFriendById(peerId);

    const peerMember = friend
      ? toPrivateFriendMemberProfile(friend, selfMember.userId)
      : toPrivatePeerMemberProfile(
          await client.get_stranger_info({ user_id: peerId }),
          selfMember.userId
        );

    if (peerMember.userId === selfMember.userId) {
      return [selfMember];
    }

    return [selfMember, peerMember];
  }

  private async findFriendById(userId: number): Promise<QQFriendInfo | undefined> {
    const client = this.requireClient();
    const friends = await client.get_friend_list();
    return friends.find((item) => item.user_id === userId);
  }

  /** 启动心跳轮询。 */
  private startHeartbeat(): void {
    if (!this.heartbeat) {
      this.heartbeat = new QQNapcatConnectionHeartbeat({
        logger: this.logger,
        intervalMs: this.config.heartbeat?.intervalMs,
        failureThreshold: this.config.heartbeat?.failureThreshold,
        reconnectOnFailure: this.config.heartbeat?.reconnectOnFailure,
        getStatus: async () => {
          const client = this.requireClient();
          return client.get_status();
        },
        reconnect: async () => {
          await this.reconnectClient();
        }
      });
    }

    this.heartbeat.start();
  }

  /** 停止心跳轮询。 */
  private stopHeartbeat(): void {
    this.heartbeat?.stop();
  }

  /** 重连后刷新登录态，确保 selfId/userName 与当前会话一致。 */
  private async reconnectClient(): Promise<void> {
    const client = this.requireClient();
    const reconnectable = client as QQNapcatClient & {
      reconnect?: () => Promise<void>;
    };

    if (typeof reconnectable.reconnect === 'function') {
      await reconnectable.reconnect();
    } else {
      try {
        client.disconnect();
      } catch {}
      await client.connect();
    }

    const login = await client.get_login_info();
    this.selfId = String(login.user_id);
    this.botUserId = login.nickname;
    this.userName = login.nickname;
  }

  private bindListeners(): void {
    if (!this.client || this.listenersBound) {
      return;
    }

    this.client.on('message.group', this.onGroupMessage);
    this.client.on('message.private', this.onPrivateMessage);
    this.client.on('notice.group_msg_emoji_like', this.onEmojiLikeMessage);

    this.listenersBound = true;
  }

  private readonly onGroupMessage = async (raw: QQGroupMessage) => {
    this.dispatchIncomingMessage(raw);
  };

  private readonly onPrivateMessage = async (raw: QQPrivateMessage) => {
    this.dispatchIncomingMessage(raw);
  };

  private readonly onEmojiLikeMessage = async (raw: QQEmojiLikeMessage) => {
    this.logger.debug('receive emoji like message', raw);

    const threadId = this.encodeThreadId({ chatType: 'group', peerId: String(raw.group_id) });
    const messageId = String(raw.message_id);
    const userId = String(raw.user_id);
    const member = await this.fetchThreadMember(threadId, userId);

    const isMe = member
      ? member.isMe
      : this.selfId !== undefined && String(raw.user_id) === this.selfId;
    const isBot = member ? member.isBot : isMe;

    for (const like of raw.likes) {
      this.chat?.processReaction({
        adapter: this,
        threadId,
        messageId,
        emoji: emoji.custom(like.emoji_id),
        rawEmoji: like.emoji_id,
        added: (raw as any).is_add ?? true,
        user: {
          userId: member?.userId || userId,
          userName: member?.userName || userId,
          fullName: member?.cardName || member?.userName || userId,
          isBot,
          isMe
        },
        raw
      });
    }
  };

  /**
   * 统一处理入站消息：
   * - 过滤 bot 自己发送的消息
   * - 计算 threadId 与 mention
   * - 交给 Chat SDK `processMessage` 进入标准事件流
   */
  private dispatchIncomingMessage(raw: QQRawMessage): void {
    if (!this.chat) {
      return;
    }

    if (isSelfMessage(raw, this.selfId)) {
      return;
    }

    const threadId = this.encodeThreadId(toThreadId(raw));
    const mention = isMention(raw, this.selfId);

    this.chat.processMessage(this, threadId, async () => {
      const message = await this.parseThreadMessage(raw);
      message.isMention = mention;
      return message;
    });
  }

  /** 获取已初始化的 NapCat 客户端，否则抛出配置错误。 */
  private requireClient(): QQNapcatClient {
    if (!this.client) {
      throw new ValidationError(
        'qq',
        'QQ adapter is not initialized. Attach it to Chat and call chat.initialize() first.'
      );
    }

    return this.client;
  }
}
