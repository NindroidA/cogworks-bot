/**
 * Drop every per-guild config cache that would otherwise keep serving a
 * guild's settings after its rows are purged (/bot-reset, guild leave). A warm
 * XP or starboard cache, for example, keeps creating XPUser / StarboardEntry
 * rows for up to five minutes after a factory reset.
 *
 * The bait caches live on the client-attached BaitChannelManager, so callers
 * that hold the client clear them with `invalidateBaitCaches`.
 */

import type { Client } from 'discord.js';
import { invalidateGuildLocaleCache } from '../../lang';
import type { ExtendedClient } from '../../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { invalidateGuildMenuCache } from '../reactionRole/menuCache';
import { invalidateRulesCache } from '../rules/rulesCache';
import { invalidateStarboardCache } from '../starboard/configCache';
import { invalidateFeaturePermissionsCache } from '../validation/featurePermission';
import { invalidateXPConfigCache } from '../xp/configCache';

export function invalidateGuildCaches(guildId: string): void {
  invalidateXPConfigCache(guildId);
  invalidateStarboardCache(guildId);
  invalidateRulesCache(guildId);
  invalidateGuildMenuCache(guildId);
  invalidateGuildLocaleCache(guildId);
  invalidateFeaturePermissionsCache(guildId);
}

/** Drop the bait config and keyword caches. Best-effort: a failure is logged, never thrown. */
export function invalidateBaitCaches(client: Client, guildId: string): void {
  try {
    const manager = (client as ExtendedClient).baitChannelManager;
    manager?.clearConfigCache(guildId);
    manager?.clearKeywordCache(guildId);
  } catch (error) {
    enhancedLogger.warn('Failed to clear the bait caches', LogCategory.COMMAND_EXECUTION, {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
