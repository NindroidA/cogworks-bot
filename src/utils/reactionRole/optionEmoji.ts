/**
 * Stored reaction-role option emoji helpers.
 *
 * Options store the emoji as typed: `<:name:id>`, `<a:name:id>` (animated),
 * `name:id`, or a unicode emoji. Reaction events carry `{ id, name }`, so
 * custom emoji are matched by id: `<a:x:id>`, `<:x:id>` and a renamed emoji
 * all resolve to the same option.
 */

/** A stored option emoji, split into the parts a reaction event carries. */
export interface ParsedOptionEmoji {
  /** Snowflake for a custom emoji, null for a unicode emoji */
  id: string | null;
  /** Custom emoji name, or the unicode emoji itself */
  name: string;
}

// `:name:id`, `a:name:id` or `name:id` once the angle brackets are stripped.
const CUSTOM_EMOJI_RE = /^(?:a?:)?(\w{2,32}):(\d{17,20})$/;

/** Parse a stored option emoji (`<:name:id>`, `<a:name:id>`, `name:id`, or unicode). */
export function parseOptionEmoji(raw: string): ParsedOptionEmoji {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
  const match = CUSTOM_EMOJI_RE.exec(inner);
  if (match) return { id: match[2], name: match[1] };
  return { id: null, name: trimmed };
}

/** Lookup key for an emoji: the snowflake for custom emoji, the emoji itself for unicode. */
export function emojiLookupKey(emoji: { id: string | null; name: string | null }): string | null {
  return emoji.id ?? emoji.name;
}

/** REST route identifier for a stored option emoji: `name:id`, or the URL-encoded unicode emoji. */
export function reactionRouteIdentifier(storedEmoji: string): string {
  const { id, name } = parseOptionEmoji(storedEmoji);
  return id ? `${name}:${id}` : encodeURIComponent(name);
}
