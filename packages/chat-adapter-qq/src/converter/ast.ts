const QQ_REPLY_TYPE = 'qq:reply';

const QQ_AT_TYPE = 'qq:at';

const QQ_FORWARD_TYPE = 'qq:forward';

export interface QQReplyNode {
  type: typeof QQ_REPLY_TYPE;
  data: { id: string };
}

export interface QQAtNode {
  type: typeof QQ_AT_TYPE;
  data: { id: string };
}

export interface QQForwardNode {
  type: typeof QQ_FORWARD_TYPE;
  data: { ids: string[] };
}

declare module 'mdast' {
  interface RootContentMap {
    'qq:at': QQAtNode;
    'qq:reply': QQReplyNode;
    'qq:forward': QQForwardNode;
  }

  interface PhrasingContentMap {
    'qq:at': QQAtNode;
  }
}

/** Create an @mention AST node that maps to `Structs.at`. */
export function at(userId: string): QQAtNode {
  return { type: QQ_AT_TYPE, data: { id: userId } };
}

/** Create a Reply AST node that maps to `Structs.reply`. */
export function reply(messageId: string): QQReplyNode {
  return { type: QQ_REPLY_TYPE, data: { id: messageId } };
}

/** Create a Forward AST node that maps to `Structs.forward`. */
export function forward(...messageIds: string[]): QQForwardNode {
  return { type: QQ_FORWARD_TYPE, data: { ids: messageIds } };
}

function hasNodeType(node: unknown, expectedType: string): boolean {
  return typeof node === 'object' && node !== null && 'type' in node && node.type === expectedType;
}

export function isQQReplyNode(node: unknown): node is QQReplyNode {
  return hasNodeType(node, QQ_REPLY_TYPE);
}

export function isQQAtNode(node: unknown): node is QQAtNode {
  return hasNodeType(node, QQ_AT_TYPE);
}

export function isQQForwardNode(node: unknown): node is QQForwardNode {
  return hasNodeType(node, QQ_FORWARD_TYPE);
}
