/**
 * XP config cache.
 *
 * Lives in utils so the message + voice event handlers can read XP config
 * without crossing the events → commands/handlers boundary. The slash command
 * setup handler shares the same cache (and invalidates on writes) — this is
 * the single source of truth.
 */

import { XPConfig } from '../../typeorm/entities/xp/XPConfig';
import { createTtlCache } from '../database/configCache';
import { lazyRepo } from '../database/lazyRepo';

const configRepo = lazyRepo(XPConfig);

const CONFIG_CACHE_TTL = 5 * 60 * 1000;
const configCache = createTtlCache<string, XPConfig>(CONFIG_CACHE_TTL);

/** Get XP config for a guild with 5-minute caching. Returns null when not configured. */
export async function getXPConfig(guildId: string): Promise<XPConfig | null> {
  // getOrLoad caches only non-null results, so unconfigured guilds (null) are
  // re-queried each call rather than cached — matching the prior behavior.
  return configCache.getOrLoad(guildId, gid => configRepo.findOne({ where: { guildId: gid } }));
}

/** Drop cached config for a guild. Call after any write to XPConfig. */
export function invalidateXPConfigCache(guildId: string): void {
  configCache.invalidate(guildId);
}

/** Drop the entire XP config cache. Used by tests + bot-reset. */
export function clearXPConfigCache(): void {
  configCache.clear();
}
