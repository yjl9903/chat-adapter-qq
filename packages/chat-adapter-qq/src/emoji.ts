import { ValidationError } from '@chat-adapter/shared';
import type { EmojiValue } from 'chat';

/**
 * Normalize Chat SDK emoji input to NapCat `emoji_id`.
 *
 * TODO:
 * - Current implementation uses plain passthrough (`string` or `EmojiValue.name`).
 * - Verify expected mapping between Chat SDK emoji representations and NapCat
 *   `set_msg_emoji_like` accepted IDs (Unicode/codepoint/custom emoji cases).
 */
export function normalizeQQEmojiId(emoji: EmojiValue | string): string {
  const id = typeof emoji === 'string' ? emoji : emoji.name;
  if (!id) {
    throw new ValidationError('qq', 'QQ reaction emoji cannot be empty');
  }
  return id;
}
