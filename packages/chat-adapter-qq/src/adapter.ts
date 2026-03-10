import {
  type Adapter,
  type AdapterPostableMessage,
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
  Message
} from 'chat';
import { ValidationError } from '@chat-adapter/shared';
import { type SendMessageSegment, NCWebsocket, Structs } from 'node-napcat-ts';

import type {
  QQAdapterConfig,
  QQGroupMessage,
  QQNapcatClient,
  QQPrivateMessage,
  QQRawMessage,
  QQThreadId
} from './types.js';

import { QQFormatConverter, extractText, toAttachments } from './format-converter.js';
import { isMention, isSelfMessage, toAuthor, toNumberId, toThreadId } from './utils.js';

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

  /** 创建 QQ 适配器实例（不发起连接）。 */
  public constructor(config: QQAdapterConfig) {
    this.config = config;
    this.userName = '';
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

  private async doInitialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = this.config.logger ?? chat.getLogger(this.name);

    if (!this.client) {
      this.client = new NCWebsocket(this.config.napcat, this.config.debug ?? false);
      this.converter = new QQFormatConverter(this.client);
    }

    this.bindListeners();

    await this.client.connect();

    const login = await this.client.get_login_info();
    this.logger.info('login with', login);

    this.selfId = String(login.user_id);
    this.botUserId = login.nickname;
    this.userName = login.nickname;
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
    throw new NotImplementedError('QQ adapter does not support editMessage yet', 'editMessage');
  }

  /** 删除指定消息。 */
  public async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    const client = this.requireClient();
    await client.delete_msg({ message_id: toNumberId(messageId, 'messageId') });
  }

  /** QQ 暂不支持反应能力（添加）。 */
  public async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError('QQ adapter does not support addReaction yet', 'addReaction');
  }

  /** QQ 暂不支持反应能力（移除）。 */
  public async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new NotImplementedError(
      'QQ adapter does not support removeReaction yet',
      'removeReaction'
    );
  }

  /** QQ 暂不支持历史消息分页拉取。 */
  public async fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<QQRawMessage>> {
    throw new NotImplementedError('QQ adapter does not support fetchMessages yet', 'fetchMessages');
  }

  /** 获取 thread 基础信息。 */
  public async fetchThread(threadId: string): Promise<ThreadInfo> {
    const parsed = this.decodeThreadId(threadId);

    return {
      id: threadId,
      channelId: threadId,
      isDM: parsed.chatType === 'private',
      metadata: {
        chatType: parsed.chatType,
        peerId: parsed.peerId
      }
    };
  }

  /** 当前实现不发送真实 typing，仅作为 no-op。 */
  public startTyping(_threadId: string, _status?: string): Promise<void> {
    return Promise.resolve();
  }

  /** 渲染格式化内容到 QQ 文本。 */
  public renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  /** 将 NapCat 原始消息转换为 Chat SDK 标准 Message。 */
  public parseMessage(raw: QQRawMessage): Message<QQRawMessage> {
    const threadId = this.encodeThreadId(toThreadId(raw));
    const text = extractText(raw);
    const isMe = this.selfId !== undefined && String(raw.user_id) === this.selfId;

    return new Message<QQRawMessage>({
      id: String(raw.message_id),
      threadId,
      text,
      formatted: this.converter.toAst(text),
      author: toAuthor(raw, isMe),
      metadata: {
        dateSent: new Date(raw.time * 1000),
        edited: false
      },
      attachments: toAttachments(raw.message),
      raw
    });
  }

  private bindListeners(): void {
    if (!this.client || this.listenersBound) {
      return;
    }

    this.client.on('message.group', this.onGroupMessage);
    this.client.on('message.private', this.onPrivateMessage);
    this.listenersBound = true;
  }

  private readonly onGroupMessage = (raw: QQGroupMessage): void => {
    this.dispatchIncomingMessage(raw);
  };

  private readonly onPrivateMessage = (raw: QQPrivateMessage): void => {
    this.dispatchIncomingMessage(raw);
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
      const message = this.parseMessage(raw);
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
