/**
 * Emoji Discord takes on a button or select option. Shared by the health
 * check (which reports bad ones) and the application panel (which falls back).
 */

/** A custom emoji: `<a:name:id>` (id in group 1) or its bare id (group 2). */
export const CUSTOM_EMOJI = /^(?:<a?:\w{2,32}:(\d{17,20})>|(\d{17,20}))$/;
// Built at runtime: the `v` flag (needed for \p{RGI_Emoji}) is newer than the compile target.
const RGI_EMOJI_SOURCE = '^\\p{RGI_Emoji}$';
const UNICODE_EMOJI = new RegExp(RGI_EMOJI_SOURCE, 'v');
const VARIATION_SELECTOR_16 = String.fromCodePoint(0xfe0f);

/** One unicode emoji. Discord also takes the text form without U+FE0F (❤ for ❤️). */
export const isUnicodeEmoji = (value: string) =>
  UNICODE_EMOJI.test(value) || UNICODE_EMOJI.test(value + VARIATION_SELECTOR_16);
