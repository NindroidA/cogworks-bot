import { ReactionRoleMenu, type ReactionRoleOption } from '../../typeorm/entities/reactionRole';
import { CACHE_TTL } from '../constants';
import { createTtlCache } from '../database/configCache';
import { lazyRepo } from '../database/lazyRepo';
import { emojiLookupKey, optionEmojiKey } from './optionEmoji';

const menuRepo = lazyRepo(ReactionRoleMenu);

/**
 * Cached menu + its derived emoji→option lookup, stored as a single value so
 * the index can never go stale relative to its menu (they share one TTL entry
 * and one invalidation). Keyed by messageId.
 */
interface CachedMenu {
  menu: ReactionRoleMenu;
  emojiIndex: Map<string, ReactionRoleOption>;
}

const menuCache = createTtlCache<string, CachedMenu>(CACHE_TTL.REACTION_ROLE_MENU);

/** Build emoji lookup map for a menu's options */
function buildEmojiIndex(menu: ReactionRoleMenu): Map<string, ReactionRoleOption> {
  const map = new Map<string, ReactionRoleOption>();
  for (const option of menu.options) {
    map.set(optionEmojiKey(option.emoji), option);
  }
  return map;
}

/** Lookup menu by message ID with caching (lazy load) */
export async function getCachedMenu(messageId: string, guildId: string): Promise<ReactionRoleMenu | null> {
  const cached = menuCache.get(messageId);
  // messageIds are globally unique, so a guild mismatch is defensive only —
  // ignore the hit and fall through to DB (re-populating for the right guild).
  if (cached && cached.menu.guildId === guildId) {
    return cached.menu;
  }

  const menu = await menuRepo.findOne({
    where: { messageId, guildId },
    relations: { options: true },
  });

  if (menu) {
    menuCache.set(messageId, { menu, emojiIndex: buildEmojiIndex(menu) });
  }

  return menu;
}

/**
 * O(1) emoji-to-option lookup for a cached menu. Pass the reaction's emoji
 * (`reaction.emoji`): custom emoji match by id, unicode emoji by name.
 */
export function getOptionByEmoji(
  messageId: string,
  emoji: { id: string | null; name: string | null },
): ReactionRoleOption | undefined {
  const cached = menuCache.get(messageId);
  if (!cached) return undefined;
  const key = emojiLookupKey(emoji);
  return key ? cached.emojiIndex.get(key) : undefined;
}

/** Invalidate cache for a specific menu (on add/remove/edit/delete) */
export function invalidateMenuCache(messageId: string): void {
  menuCache.invalidate(messageId);
}

/** Invalidate all cache entries for a guild (on guild leave) */
export function invalidateGuildMenuCache(guildId: string): void {
  menuCache.invalidateWhere(value => value.menu.guildId === guildId);
}
