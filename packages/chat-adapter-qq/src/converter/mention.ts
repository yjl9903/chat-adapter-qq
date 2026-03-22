/**
 * Result of scanning a mention token from plain text.
 *
 * - `id`: resolved QQ user id
 * - `end`: exclusive end offset, so callers can continue scanning from `value[end]`
 */
export interface ParsedQQMentionToken {
  id: string;
  end: number;
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function isEscapedCharacter(value: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function escapeMarkdownInlineText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([`*_{}\[\]()<>|])/g, '\\$1');
}

function unescapeMarkdownInlineText(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()<>|])/g, '$1');
}

/**
 * Canonical mention string format used by this adapter.
 *
 * Emitted forms:
 * - named mention: `@alice{qq:10001}`
 * - id-only fallback when no label is available: `@10001`
 *
 * The label is markdown-escaped so the token stays as plain text instead of
 * accidentally turning into emphasis / link-like syntax.
 */
export function formatQQMentionToken(userId: string, label?: string | null): string {
  const normalizedId = String(userId);
  const normalizedLabel = (label ?? '').replace(/\r\n?/g, ' ').trim();

  if (!normalizedLabel || normalizedLabel === normalizedId) {
    return `@${normalizedId}`;
  }

  return `@${escapeMarkdownInlineText(normalizedLabel)}{qq:${normalizedId}}`;
}

export function formatQQPlainMentionText(userId: string, label?: string | null): string {
  const normalizedLabel = (label ?? '').trim();
  return `@${normalizedLabel || userId}`;
}

function parseLegacyQQMentionToken(value: string, start: number): ParsedQQMentionToken | null {
  let end = start + 1;
  while (isDigit(value[end])) {
    end += 1;
  }

  if (end === start + 1) {
    return null;
  }

  return {
    id: value.slice(start + 1, end),
    end
  };
}

/**
 * Parse the canonical named token form: `@alice{qq:10001}`.
 *
 * Rules:
 * - parsing starts at the `@`
 * - the first valid `{qq:<digits>}` suffix closes the token
 * - parsing stops at a newline
 * - escaped `\{qq:...}` text inside the label is ignored
 */
function parseNamedQQMentionToken(value: string, start: number): ParsedQQMentionToken | null {
  for (let index = start + 1; index < value.length; index += 1) {
    const current = value[index];

    if (current === '\n' || current === '\r') {
      return null;
    }

    const prefix = '{qq:';
    if (current !== '{' || isEscapedCharacter(value, index) || !value.startsWith(prefix, index)) {
      continue;
    }

    const label = value.slice(start + 1, index);
    if (label.trim().length === 0 || label !== label.trim()) {
      continue;
    }

    let idEnd = index + prefix.length;
    while (isDigit(value[idEnd])) {
      idEnd += 1;
    }

    if (idEnd === index + prefix.length || value[idEnd] !== '}') {
      continue;
    }

    return {
      id: value.slice(index + prefix.length, idEnd),
      end: idEnd + 1
    };
  }

  return null;
}

/**
 * Supported input forms for tokenizer-style scanning:
 * - legacy numeric mention: `@10001`
 * - canonical named mention: `@alice{qq:10001}`
 *
 * The caller must pass the index of the `@`. On success, `end` is exclusive.
 */
export function parseQQMentionToken(value: string, start: number): ParsedQQMentionToken | null {
  if (value[start] !== '@') {
    return null;
  }

  return parseNamedQQMentionToken(value, start) ?? parseLegacyQQMentionToken(value, start);
}

export function extractQQMentionTokenLabel(
  value: string,
  start: number,
  end: number,
  id: string
): string | null {
  const suffix = `{qq:${id}}`;
  if (!value.startsWith('@', start) || !value.startsWith(suffix, end - suffix.length)) {
    return null;
  }

  const label = value.slice(start + 1, end - suffix.length);
  return label.length > 0 ? unescapeMarkdownInlineText(label) : null;
}
