import {
  type AdapterPostableMessage,
  type Attachment,
  type FileUpload,
  type Logger,
  isCardElement
} from 'chat';

import { type SendMessageSegment, Structs } from 'node-napcat-ts';

type QQAttachmentMediaType = 'image' | 'video' | 'audio' | 'file' | 'record';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v']);
const AUDIO_EXTS = new Set(['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'wma', 'opus']);

function extFromFilename(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return undefined;
  return filename.slice(dot + 1).toLowerCase();
}

function getFileUploadMediaType(file: FileUpload): 'image' | 'video' | 'audio' | 'file' {
  const mime = file.mimeType;
  if (mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
  }

  const ext = extFromFilename(file.filename);
  if (ext) {
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
  }

  return 'file';
}

function getAttachmentMediaType(attachment: Attachment): QQAttachmentMediaType {
  return (attachment.type as QQAttachmentMediaType | undefined) ?? 'file';
}

async function resolveAttachmentData(
  attachment: Attachment,
  logger?: Logger
): Promise<string | Buffer | null> {
  if (attachment.data) {
    if (Buffer.isBuffer(attachment.data)) return attachment.data;
    if (attachment.data instanceof Blob) {
      return Buffer.from(await attachment.data.arrayBuffer());
    }
    return null;
  }

  if (attachment.fetchData) {
    return attachment.fetchData();
  }

  if (attachment.url) {
    return attachment.url;
  }

  logger?.warn('Attachment has no data, fetchData, or url — skipping', attachment.name);
  return null;
}

async function resolveFileUpload(file: FileUpload): Promise<Buffer> {
  if (Buffer.isBuffer(file.data)) return file.data;
  if (file.data instanceof Blob) {
    return Buffer.from(await file.data.arrayBuffer());
  }
  return Buffer.from(file.data as ArrayBuffer);
}

function toMediaSegment(
  mediaType: QQAttachmentMediaType,
  data: string | Buffer,
  name?: string
): SendMessageSegment {
  switch (mediaType) {
    case 'image':
      return Structs.image(data, name);
    case 'video':
      return Structs.video(data, name);
    case 'audio':
    case 'record':
      return Structs.record(data);
    case 'file':
      return Structs.file(data, name);
  }
}

export function extractMedia(message: AdapterPostableMessage): {
  files: FileUpload[];
  attachments: Attachment[];
} {
  if (typeof message === 'string' || isCardElement(message)) {
    return { files: [], attachments: [] };
  }

  if ('card' in message) {
    return { files: message.files ?? [], attachments: [] };
  }

  return {
    files: message.files ?? [],
    attachments: message.attachments ?? []
  };
}

export async function toFileSegments(
  files: FileUpload[],
  attachments: Attachment[],
  logger?: Logger
): Promise<SendMessageSegment[]> {
  const segments: SendMessageSegment[] = [];

  for (const file of files) {
    try {
      const buffer = await resolveFileUpload(file);
      const mediaType = getFileUploadMediaType(file);
      segments.push(toMediaSegment(mediaType, buffer, file.filename));
    } catch (error) {
      logger?.warn('Failed to resolve FileUpload — skipping', file.filename, error);
    }
  }

  for (const attachment of attachments) {
    try {
      const data = await resolveAttachmentData(attachment, logger);
      if (data === null) continue;
      const mediaType = getAttachmentMediaType(attachment);
      segments.push(toMediaSegment(mediaType, data, attachment.name));
    } catch (error) {
      logger?.warn('Failed to resolve Attachment — skipping', attachment.name, error);
    }
  }

  return segments;
}
