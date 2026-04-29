/**
 * XP config cache.
 *
 * Lives in utils so the message + voice event handlers can read XP config
 * without crossing the events → commands/handlers boundary. The slash command
 * setup handler shares the same cache (and invalidates on writes) — this is
 * the single source of truth.
 */

import { XPConfig } from '../../typeorm/entities/xp/XPConfig';
import { lazyRepo } from '../database/lazyRepo';

const configRepo = lazyRepo(XPConfig);

const CONFIG_CACHE_TTL = 5 * 60 * 1000;
const configCache = new Map<string, { config: XPConfig; cachedAt: number }>();

/** Get XP config for a guild with 5-minute caching. Returns null when not configured. */
export async function getXPConfig(guildId: string): Promise<XPConfig | null> {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL) {
    return cached.config;
  }

  const config = await configRepo.findOne({ where: { guildId } });
  if (config) {
    configCache.set(guildId, { config, cachedAt: Date.now() });
  } else {
    configCache.delete(guildId);
  }
  return config;
}

/** Drop cached config for a guild. Call after any write to XPConfig. */
export function invalidateXPConfigCache(guildId: string): void {
  configCache.delete(guildId);
}

/** Drop the entire XP config cache. Used by tests + bot-reset. */
export function clearXPConfigCache(): void {
  configCache.clear();
}
