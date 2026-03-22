# QQ adapter media refresh

## Goal

QQ/NapCat message attachments often contain temporary download URLs. Those URLs can expire, so the adapter now preserves the NapCat media handle needed to request a fresh URL later.

## Incoming attachment metadata

For incoming attachments, `message.attachments[*]` may now include:

```ts
attachment.qq
```

Shape:

```ts
{
  kind: 'image' | 'file' | 'video' | 'record';
  file: string;
  fileId?: string;
}
```

- Images preserve `file`, which can be passed to NapCat `get_image`.
- Files preserve both `file` and `fileId`; refresh prefers `fileId` and falls back to `file`.
- Videos preserve `file` and refresh through `get_file`.
- Records preserve `file` and refresh through `get_record`.

## Adapter method

`QQAdapter` now provides:

- `adapter.refreshAttachment(source, kind?)`

`refreshAttachment` chooses the correct NapCat API based on `attachment.qq.kind`:

- `image` -> `get_image`
- `file` -> `get_file`
- `video` -> `get_file`
- `record` -> `get_record`

If `source` is a raw string, pass `kind` explicitly.

## Usage

```ts
const attachment = message.attachments[0];
const refreshed = await adapter.refreshAttachment(attachment);

console.log(refreshed.url);

const image = await adapter.refreshAttachment('cache/image-key', 'image');
```

If you only persisted the expired CDN URL and did not store the QQ handle, the URL cannot be renewed.
