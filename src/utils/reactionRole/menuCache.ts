import { AppDataSource } from '../../typeorm';
import { ReactionRoleMenu, type ReactionRoleOption } from '../../typeorm/entities/reactionRole';

const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

// In-memory cache: Map<messageId, ReactionRoleMenu>
const menuCache = new Map<string, ReactionRoleMenu>();

// Pre-built emoji-to-option lookup: Map<messageId, Map<emoji, ReactionRoleOption>>
const emojiIndex = new Map<string, Map<string, ReactionRoleOption>>();

/** Build emoji lookup map for a menu's options */
function buildEmojiIndex(menu: ReactionRoleMenu): Map<string, ReactionRoleOption> {
  const map = new Map<string, ReactionRoleOption>();
  for (const option of menu.options) {
    map.set(option.emoji, option);
  }
  return map;
}

/** Lookup menu by message ID with caching (lazy load) */
export async function getCachedMenu(
  messageId: string,
  guildId: string,
): Promise<ReactionRoleMenu | null> {
  const cached = menuCache.get(messageId);
  if (cached) {
    if (cached.guildId === guildId) return cached;
    // Cache hit but wrong guild — ignore and fall through to DB
  }

  const menu = await menuRepo.findOne({
    where: { messageId, guildId },
    relations: ['options'],
  });

  if (menu) {
    menuCache.set(messageId, menu);
    emojiIndex.set(messageId, buildEmojiIndex(menu));
  }

  return menu;
}

/** O(1) emoji-to-option lookup for a cached menu */
export function getOptionByEmoji(
  messageId: string,
  emoji: string,
  emojiName: string | null,
): ReactionRoleOption | undefined {
  const index = emojiIndex.get(messageId);
  if (!index) return undefined;
  return index.get(emoji) || (emojiName ? index.get(emojiName) : undefined);
}

/** Invalidate cache for a specific menu (on add/remove/edit/delete) */
export function invalidateMenuCache(messageId: string): void {
  menuCache.delete(messageId);
  emojiIndex.delete(messageId);
}

/** Invalidate all cache entries for a guild (on guild leave) */
export function invalidateGuildMenuCache(guildId: string): void {
  for (const [messageId, menu] of menuCache) {
    if (menu.guildId === guildId) {
      menuCache.delete(messageId);
      emojiIndex.delete(messageId);
    }
  }
}
