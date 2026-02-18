import { AppDataSource } from '../../typeorm';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';

const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

// In-memory cache: Map<messageId, ReactionRoleMenu>
const menuCache = new Map<string, ReactionRoleMenu>();

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
  }

  return menu;
}

/** Invalidate cache for a specific menu (on add/remove/edit/delete) */
export function invalidateMenuCache(messageId: string): void {
  menuCache.delete(messageId);
}

/** Invalidate all cache entries for a guild (on guild leave) */
export function invalidateGuildMenuCache(guildId: string): void {
  for (const [messageId, menu] of menuCache) {
    if (menu.guildId === guildId) {
      menuCache.delete(messageId);
    }
  }
}
