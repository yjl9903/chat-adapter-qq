import type { Attachment } from 'chat';

import type { QQNapcatClient, QQAttachmentHandle } from '../types.js';

type QQAttachmentRefreshSource = Attachment | QQAttachmentHandle | string;

function parseFileSize(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapNapcatResource(
  data: {
    file: string;
    url?: string;
    file_size?: string | number;
    file_name?: string;
    base64?: string;
  },
  handle: QQAttachmentHandle
): Attachment {
  return {
    // Chat SDK 仅定义了 `audio`，因此 QQ 的 `record` 在对外模型中折叠为 `audio`。
    type: handle.kind === 'record' ? 'audio' : handle.kind,
    name: data.file_name,
    url: data.url,
    size: parseFileSize(data.file_size),
    qq: handle,
    data: data.base64 ? Buffer.from(data.base64, 'base64') : undefined
  };
}

function getQQAttachmentHandle(attachment: Attachment): QQAttachmentHandle | null {
  return attachment.qq ?? null;
}

function normalizeQQAttachmentHandle(
  source: QQAttachmentRefreshSource,
  kind?: QQAttachmentHandle['kind']
): QQAttachmentHandle {
  if (typeof source === 'string') {
    if (!kind) {
      throw new Error('QQ attachment refresh requires kind when source is a string.');
    }
    return { kind, file: source };
  }

  const handle = 'type' in source ? getQQAttachmentHandle(source) : source;

  if (!handle) {
    throw new Error('Attachment does not contain QQ refresh metadata.');
  }

  return handle;
}

export async function refreshQQAttachment(
  client: QQNapcatClient,
  source: QQAttachmentRefreshSource,
  kind?: QQAttachmentHandle['kind']
): Promise<Attachment> {
  // 统一接受 Attachment、QQ 句柄或裸文件标识，再按 NapCat 媒体类型分派。
  const handle = normalizeQQAttachmentHandle(source, kind);

  if (handle.kind === 'image') {
    if (!handle.file) {
      throw new Error('QQ image refresh requires an image attachment handle with a file value.');
    }
    return mapNapcatResource(await client.get_image({ file: handle.file }), handle);
  }

  if (handle.kind === 'record') {
    if (!handle.file) {
      throw new Error('QQ record refresh requires a record attachment handle with a file value.');
    }
    // 语音在 NapCat 中有独立的 get_record 接口，不能和普通文件共用 get_file。
    return mapNapcatResource(await client.get_record({ file: handle.file }), handle);
  }

  if (!handle.file && !handle.fileId) {
    throw new Error('QQ file refresh requires a file attachment handle with file or fileId.');
  }

  // 普通文件和视频都通过 get_file 刷新下载地址。
  return mapNapcatResource(await client.get_file({ file: handle.fileId ?? handle.file }), handle);
}
