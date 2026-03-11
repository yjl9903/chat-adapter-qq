import type { Logger } from 'chat';
import type {
  MessageHandler as NapcatMessageHandler,
  GroupMsgEmojiLike,
  NCWebsocket,
  NCWebsocketOptions,
  WSSendReturn
} from 'node-napcat-ts';

import type { CachedNCWebsocketOptions } from './napcat/cached-client';

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

/** QQ 群成员信息。 */
export type QQGroupMemberInfo = WSSendReturn['get_group_member_info'];

/** QQ 登录信息。 */
export type QQLoginInfo = WSSendReturn['get_login_info'];

/** QQ 陌生人信息（用于私聊对端资料）。 */
export type QQStrangerInfo = WSSendReturn['get_stranger_info'];

/** QQ 好友信息（来自好友列表）。 */
export type QQFriendInfo = WSSendReturn['get_friend_list'][number];

/** QQ 成员查询原始数据。 */
export type QQMemberRaw = QQGroupMemberInfo | QQLoginInfo | QQFriendInfo | QQStrangerInfo;

/** QQ 成员统一结构。 */
export interface QQMemberProfile {
  /** 用户 ID（字符串） */
  userId: string;

  /** 用户名 */
  userName: string;

  /** 名片（群聊 card / 私聊 remark） */
  cardName: string;

  /** 是否机器人 */
  isBot: boolean;

  /** 是否当前 bot 自己 */
  isMe: boolean;

  /** 原始完整数据 */
  raw: QQMemberRaw;
}

/** QQ 适配器配置。 */
export interface QQAdapterConfig {
  /** NapCat 连接配置（必填）。 */
  napcat: NCWebsocketOptions;

  /** 缓存配置 */
  cache?: CachedNCWebsocketOptions;

  /** 是否启用 NapCat SDK 的 debug 输出。 */
  debug?: boolean;

  /** 自定义 logger；未传时使用 Chat SDK 提供的 logger。 */
  logger?: Logger;
}
