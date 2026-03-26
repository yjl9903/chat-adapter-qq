import type { Logger } from 'chat';
import type {
  MessageHandler as NapcatMessageHandler,
  GroupMsgEmojiLike,
  NCWebsocket,
  NCWebsocketOptions,
  WSErrorRes,
  WSReconnection,
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

/** NapCat 状态查询结果。 */
export type QQNapcatStatus = Awaited<ReturnType<QQNapcatClient['get_status']>>;

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

/** QQ 连接心跳配置。 */
export interface QQHeartbeatConfig {
  /** 轮询间隔（毫秒，默认 30000）。 */
  intervalMs?: number;

  /** 连续失败达到阈值后触发重连（默认 2）。 */
  failureThreshold?: number;

  /** 心跳异常时是否自动重连（默认 true）。 */
  reconnectOnFailure?: boolean;
}

/** QQ 适配器配置。 */
export interface QQAdapterConfig {
  /** NapCat 连接配置（必填）。 */
  napcat: NCWebsocketOptions;

  /** 缓存配置 */
  cache?: CachedNCWebsocketOptions;

  /** 是否启用 NapCat SDK 的 debug 输出。 */
  debug?: boolean;

  /** WS 健康检查配置。 */
  heartbeat?: QQHeartbeatConfig;

  /** 自定义 logger；未传时使用 Chat SDK 提供的 logger。 */
  logger?: Logger;
}

export interface QQAdapterSocketConnectingEvent {
  type: 'socket.connecting';
  reconnection: WSReconnection;
}

export interface QQAdapterSocketOpenEvent {
  type: 'socket.open';
  reconnection: WSReconnection;
}

export interface QQAdapterSocketCloseEvent {
  type: 'socket.close';
  code: number;
  reason: string;
  reconnection: WSReconnection;
}

export interface QQAdapterSocketErrorEvent {
  type: 'socket.error';
  error: WSErrorRes;
  reconnection: WSReconnection;
}

export interface QQAdapterHeartbeatFailureEvent {
  type: 'heartbeat.failure';
  failures: number;
  threshold: number;
  status?: QQNapcatStatus;
  error?: unknown;
  willReconnect: boolean;
}

export interface QQAdapterHeartbeatReconnectingEvent {
  type: 'heartbeat.reconnecting';
  failures: number;
  threshold: number;
  trigger: 'heartbeat';
  status?: QQNapcatStatus;
}

export interface QQAdapterHeartbeatReconnectedEvent {
  type: 'heartbeat.reconnected';
  failures: number;
  threshold: number;
  trigger: 'heartbeat';
  status?: QQNapcatStatus;
}

export interface QQAdapterEventMap {
  'socket.connecting': QQAdapterSocketConnectingEvent;
  'socket.open': QQAdapterSocketOpenEvent;
  'socket.close': QQAdapterSocketCloseEvent;
  'socket.error': QQAdapterSocketErrorEvent;
  'heartbeat.failure': QQAdapterHeartbeatFailureEvent;
  'heartbeat.reconnecting': QQAdapterHeartbeatReconnectingEvent;
  'heartbeat.reconnected': QQAdapterHeartbeatReconnectedEvent;
}

export type QQAdapterEvent = keyof QQAdapterEventMap;

export type QQAdapterEventHandler<T extends QQAdapterEvent> = (
  payload: QQAdapterEventMap[T]
) => void | Promise<void>;

/** 可用于向 NapCat 重新获取临时下载地址的 QQ 文件句柄。 */
export interface QQAttachmentHandle {
  /**
   * NapCat 侧的媒体类别。
   * 注意这里保留 `record`，用于区分 `get_record` 与 `get_file`；
   * 但对外暴露给 Chat SDK 的 Attachment.type 仍保持 `audio` 语义。
   */
  kind: 'image' | 'file' | 'video' | 'record';

  /** NapCat 可识别的文件标识。 */
  file: string;

  /** 某些文件消息额外提供的稳定 file_id。 */
  fileId?: string;

  /** 是否为表情包图片 */
  emoji?: {
    id?: string;

    packageId?: number;
  };
}

// 扩展 chat 原有的消息类型
declare module 'chat' {
  interface Attachment {
    /**
     * QQ / NapCat 媒体续期句柄。
     * 用于在临时下载 URL 过期后重新调用 NapCat API 获取新链接。
     */
    qq?: QQAttachmentHandle;
  }

  interface PostableMarkdown {
    /** QQ reply target message id. */
    reply?: string;
    /** QQ forward target message ids. */
    forward?: string[];
  }

  interface PostableAst {
    /** QQ reply target message id. */
    reply?: string;
    /** QQ forward target message ids. */
    forward?: string[];
  }

  interface PostableCard {
    /** QQ reply target message id. */
    reply?: string;
    /** QQ forward target message ids. */
    forward?: string[];
  }
}
