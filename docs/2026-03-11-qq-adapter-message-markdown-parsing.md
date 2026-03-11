# qq adapter message markdown parsing - 2026-03-11

Status: `current`

## Scope

Inbound parsing path for QQ adapter:

1. NapCat segments -> Markdown text
2. Markdown -> Chat SDK AST (`parseMarkdown`)
3. AST -> plain text (`toPlainTextPreserveBreaks`)

For full adapter status, see `docs/2026-03-12-qq-adapter-current-status.md`.

## Main implementation

- converter: `packages/chat-adapter-qq/src/converter/index.ts`
- plain-text renderer: `packages/chat-adapter-qq/src/converter/to-plain-text.ts`
- adapter entry points:
  - sync: `QQAdapter.parseMessage(raw)`
  - async: `QQAdapter.parseThreadMessage(raw)`

## Parsing modes

### Sync path (`parseIncomingSync`)

- pure segment mapping
- no NapCat API calls
- `reply`/`forward` use placeholders

### Async path (`parseIncoming`)

- supports reply/forward expansion through NapCat `get_msg`
- used by `parseThreadMessage`, which is the runtime path for inbound dispatch

## Segment mapping (current)

- `text` -> raw text
- `at` -> `@{qq}` or `@所有人`
- `face` -> `表情:{id}`
- `image`
  - with URL: markdown image `![name](url)`
  - without URL: fallback label `图片:{name}`
- `file`
  - if `file` is URL: markdown link `[name](url)`
  - otherwise: fallback label `附件:{name}`
- `video`
  - prefer `url`, fallback to `file` when it is URL
  - otherwise: fallback label `视频:{name}`
- `record`
  - if `file` is URL: markdown link
  - otherwise: fallback label `音频:{name}`
- `reply`
  - sync: placeholder quote
  - async (first active segment only): fetch quoted message and render blockquote with author + body
- `forward`
  - sync: placeholder quote
  - async when standalone message: fetch expanded content via current message `get_msg`
  - sync also supports inline `forward.data.content` recursive rendering when content exists
- `markdown` -> raw markdown content
- filtered out: `rps`, `poke`, `shake`
- other unsupported segment types currently render as empty text

## Attachment extraction

Converter also emits Chat SDK attachments for:

- `image` -> `type: image`
- `file` -> `type: file`
- `video` -> `type: video`
- `record` -> `type: audio`

When available, converter fills `name`, `url`, and parsed numeric `size`.

## Runtime assumptions

- reply expansion is attempted only when `reply` is the first non-filtered segment
- standalone forward expansion uses `get_msg(message_id)` on current message
- on expansion failure, converter falls back to placeholders

## Tests

- `packages/chat-adapter-qq/test/message-parsing.test.ts`
  - attachments and markdown/plain-text rendering
  - reply/forward placeholders
  - async reply quote expansion
  - async standalone forward expansion
  - nested forward expansion
