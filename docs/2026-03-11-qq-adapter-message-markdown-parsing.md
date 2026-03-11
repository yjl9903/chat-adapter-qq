# qq adapter message markdown parsing - 2026-03-11

## Background

The QQ adapter previously parsed incoming NapCat segments into plain text with simple placeholders, then generated `formatted` from that text. This lost structure for non-text segments.

This document records the implementation design for upgrading inbound parsing to:

1. NapCat segments -> Markdown text
2. Markdown text -> Chat SDK AST (`parseMarkdown`)
3. AST -> plain text (`toPlainText`)

## Scope

In scope:

- Inbound parsing path (`parseMessage` + `parseThreadMessage`)
- `QQFormatConverter` owns NapCat segment-to-markdown parsing
- richer attachment extraction for image/file/video/record
- resolve `reply` / `forward` by NapCat query APIs in async parse path

Out of scope:

- outbound message segment rendering (`postMessage` remains text segment only)

## Parsing Strategy

### Primary pipeline

- `QQFormatConverter.parseIncomingSync(raw)` is used by sync parse path.
- `QQFormatConverter.parseIncoming(raw)` is used by async parse path and can call NapCat APIs.
- Both return:
  - `markdown`
  - `formatted`
  - `text`
  - `attachments`

### Runtime assumptions

- `reply` segment only appears as the first non-filtered segment of a message.
- `forward` segment appears as a standalone message (single non-filtered segment).
- `get_msg(message_id)` for a standalone forward message returns fully expanded quoted content
  (including nested forward content).
- `forward.data.content` is treated as full message objects and is parsed recursively without depth cap.

### Segment mapping rules

- `text` -> raw text
- `at` -> `@{qq}` / `@all`
- `face` -> `[face:{id}]`
- `image` -> markdown image `![name](url)`; if no URL, fallback to `image: {name}`
- `video` / `record` / `file`:
  - if URL is available, output markdown link `[name](url)`
  - if URL is unavailable, output plain text `attachment: {name}`
- `reply`:
  - sync path: blockquote placeholder `> reply #{id} (placeholder)`
  - async path: call `get_msg`, render quote block as `发送人 + 消息体`; fallback to placeholder on failure
- `forward`:
  - sync path: blockquote placeholder `> forward #{id} (placeholder)`
  - async path: call `get_msg` with the current message id and reuse returned expanded content
  - fallback to placeholder on API failure
- `markdown` -> inline raw markdown content
- `dice` -> `[dice:{result}]`
- `json` -> `[json]`
- `rps` / `poke` / `shake` -> filtered out

### Attachment policy

- keep generating Chat SDK attachments for media/file segments
- populate `name/url/size` when available
- `file_size` is parsed from string to number when valid

## Compatibility Notes

- mention detection is unchanged (`isMention` still uses `at selfId` for groups and always true for private)
- no public API signature change
- text rendering may differ for non-text segments due to markdown conversion

## Test Plan

- Update parse tests to assert:
  - markdown-derived `text` contains mention and generated placeholders/labels
  - image segment yields image attachment with size
  - file/video/record link behavior with and without URL
  - sync parse keeps reply/forward placeholders
  - async parse resolves reply/forward into quote content when API data is available
  - `rps`/`poke` are filtered from resulting text
- Keep integration tests green to ensure event flow regressions are not introduced.
