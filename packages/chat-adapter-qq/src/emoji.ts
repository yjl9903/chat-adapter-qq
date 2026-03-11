import { DEFAULT_EMOJI_MAP, type EmojiFormats, type EmojiValue, emoji } from 'chat';

import { ValidationError } from '@chat-adapter/shared';

const QQ_PLATFORM_EMOJI_ID_MAP: Record<string, string> = {
  [emoji.thumbs_up.name]: '76',
  [emoji.ok_hand.name]: '124',
  [emoji.heart.name]: '66'
};

function getFirstEmojiCodePoint(formats: EmojiFormats): string | undefined {
  const unicodeEmoji = Array.isArray(formats.gchat) ? formats.gchat[0] : formats.gchat;
  if (!unicodeEmoji) return undefined;

  const [firstChar] = Array.from(unicodeEmoji);
  if (!firstChar) return undefined;

  const codePoint = firstChar.codePointAt(0);
  return codePoint === undefined ? undefined : String(codePoint);
}

const GENERIC_EMOJI_CODEPOINT_MAP: Record<string, string> = Object.entries(
  DEFAULT_EMOJI_MAP
).reduce(
  (acc, [name, formats]) => {
    const codePoint = getFirstEmojiCodePoint(formats);
    if (codePoint) {
      acc[name] = codePoint;
    }
    return acc;
  },
  {} as Record<string, string>
);

function resolveEmojiValue(value: EmojiValue) {
  const platformEmojiId = QQ_PLATFORM_EMOJI_ID_MAP[value.name];
  if (platformEmojiId !== undefined) return platformEmojiId;

  const genericCodePoint = GENERIC_EMOJI_CODEPOINT_MAP[value.name];
  if (genericCodePoint !== undefined) return genericCodePoint;

  // Unknown emoji names fall back to raw name.
  return value.name;
}

/**
 * Normalize Chat SDK emoji input to NapCat `emoji_id`.
 *
 * TODO:
 * - Current implementation uses plain passthrough (`string` or `EmojiValue.name`).
 * - Verify expected mapping between Chat SDK emoji representations and NapCat
 *   `set_msg_emoji_like` accepted IDs (Unicode/codepoint/custom emoji cases).
 */
export function normalizeQQEmojiId(emoji: EmojiValue | string): string {
  const id = typeof emoji === 'string' ? emoji : resolveEmojiValue(emoji);
  if (!id) {
    throw new ValidationError('qq', 'QQ reaction emoji cannot be empty');
  }
  return id;
}
