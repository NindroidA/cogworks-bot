/**
 * Rules Config Cache
 *
 * In-memory cache for RulesConfig entries, keyed by message ID.
 * Used by the rules reaction handler for fast lookups on every reaction event.
 * Extracted to utils layer so API handlers can invalidate without importing from events/.
 */

import type { RulesConfig } from '../../typeorm/entities/rules';
import { CACHE_TTL } from '../constants';
import { createTtlCache } from '../database/configCache';

// In-memory cache keyed by messageId (TTL-evicted on read).
const rulesCache = createTtlCache<string, RulesConfig>(CACHE_TTL.RULES);

/** Get a cached rules config by message ID, or null if expired/missing. */
export function getCachedRulesConfig(messageId: string): RulesConfig | null {
  return rulesCache.get(messageId) ?? null;
}

/** Cache a rules config entry. */
export function setCachedRulesConfig(messageId: string, config: RulesConfig): void {
  rulesCache.set(messageId, config);
}

/** Clear all cached entries for a guild (called on setup/remove/guild leave). */
export function invalidateRulesCache(guildId: string): void {
  // messageId-keyed cache, guild-scoped invalidation — match on the entry's guildId.
  rulesCache.invalidateWhere(config => config.guildId === guildId);
}
