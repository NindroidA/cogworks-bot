/**
 * Rules Config Cache
 *
 * In-memory cache for RulesConfig entries, keyed by message ID.
 * Used by the rules reaction handler for fast lookups on every reaction event.
 * Extracted to utils layer so API handlers can invalidate without importing from events/.
 */

import type { RulesConfig } from '../../typeorm/entities/rules';
import { CACHE_TTL } from '../constants';

// In-memory cache: Map<messageId, { config, cachedAt }>
const rulesCache = new Map<string, { config: RulesConfig; cachedAt: number }>();

/** Get a cached rules config by message ID, or null if expired/missing. */
export function getCachedRulesConfig(messageId: string): RulesConfig | null {
  const cached = rulesCache.get(messageId);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > CACHE_TTL.RULES) {
    rulesCache.delete(messageId);
    return null;
  }
  return cached.config;
}

/** Cache a rules config entry. */
export function setCachedRulesConfig(messageId: string, config: RulesConfig): void {
  rulesCache.set(messageId, { config, cachedAt: Date.now() });
}

/** Clear all cached entries for a guild (called on setup/remove/guild leave). */
export function invalidateRulesCache(guildId: string): void {
  for (const [messageId, entry] of rulesCache) {
    if (entry.config.guildId === guildId) {
      rulesCache.delete(messageId);
    }
  }
}
