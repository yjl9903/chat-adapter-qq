import type { Logger } from 'chat';
import type {
  MessageHandler as NapcatMessageHandler,
  GroupMsgEmojiLike,
  NCWebsocket,
  NCWebsocketOptions,
  WSSendReturn
} from 'node-napcat-ts';

/**
 * QQ 会话类型。
 * - `group`: 群会话
 * - `private`: 私聊会话
 */
export type QQChatType = 'group' | 'private';

/**
 * QQ thread ID 的解码结构。
 * 对应编码格式：`qq:{chatType}:{peerId}`。
 */
export interface QQThreadId {
  /** 会话类型（群/私聊） */
  chatType: QQChatType;

  /** 对端 ID：群号或用户 QQ 号（字符串形式） */
  peerId: string;
}

/** NapCat WebSocket 客户端类型别名。 */
export type QQNapcatClient = NCWebsocket;

/** NapCat API 查询返回的消息类型。 */
export type QQApiMessage = WSSendReturn['get_msg'];

/** QQ 适配器统一使用的原始消息类型（WS 推送 + API 查询）。 */
export type QQRawMessage = NapcatMessageHandler['message'] | QQApiMessage;

/** QQ 群消息原始类型。 */
export type QQGroupMessage = NapcatMessageHandler['message.group'];

/** QQ 私聊消息原始类型。 */
export type QQPrivateMessage = NapcatMessageHandler['message.private'];

/** QQ 贴表情 */
export type QQEmojiLikeMessage = GroupMsgEmojiLike;

/** QQ 适配器配置。 */
export interface QQAdapterConfig {
  /** NapCat 连接配置（必填）。 */
  napcat: NCWebsocketOptions;

  /** 是否启用 NapCat SDK 的 debug 输出。 */
  debug?: boolean;

  /** 自定义 logger；未传时使用 Chat SDK 提供的 logger。 */
  logger?: Logger;
}
