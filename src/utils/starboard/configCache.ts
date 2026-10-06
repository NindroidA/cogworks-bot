/**
 * Starboard config cache.
 *
 * Lives in utils (like xp/configCache) so the guild purge in
 * `deleteAllGuildData` can invalidate it without importing from events/.
 */

import { StarboardConfig } from '../../typeorm/entities/starboard/StarboardConfig';
import { CACHE_TTL } from '../constants';
import { createTtlCache } from '../database/configCache';
import { lazyRepo } from '../database/lazyRepo';

const configRepo = lazyRepo(StarboardConfig);

const configCache = createTtlCache<string, StarboardConfig>(CACHE_TTL.STARBOARD_CONFIG);

/** Get starboard config with TTL cache (getOrLoad never caches misses) */
export function getStarboardConfig(guildId: string): Promise<StarboardConfig | null> {
  return configCache.getOrLoad(guildId, id => configRepo.findOneBy({ guildId: id }));
}

/** Invalidate starboard cache for a guild (call on config change or guild leave) */
export function invalidateStarboardCache(guildId: string): void {
  configCache.invalidate(guildId);
}
