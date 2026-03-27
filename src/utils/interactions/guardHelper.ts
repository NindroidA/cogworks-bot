/**
 * Permission + Rate Limit Guard Helper
 *
 * Combines the admin permission check and rate limit check into a single call.
 * Replies with the appropriate error message and returns { allowed: false } on failure.
 */

import { type Interaction, MessageFlags } from 'discord.js';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { createRateLimitKey, type RateLimitConfig, rateLimiter } from '../security/rateLimiter';
import { requireAdmin } from '../validation/permissionValidator';

export interface GuardResult {
  allowed: boolean;
}

type KeyScope = 'user' | 'guild' | 'userGuild';

interface GuardOptions {
  /** Rate limit key action name (e.g., 'ticket-create') */
  action: string;
  /** Rate limit configuration from RateLimits */
  limit: RateLimitConfig;
  /** Key scope: 'user' (default), 'guild', or 'userGuild' */
  scope?: KeyScope;
  /** Skip the admin check (for commands that only need rate limiting) */
  skipAdmin?: boolean;
}

/**
 * Combined admin permission + rate limit guard.
 * Replies with an ephemeral error and returns `{ allowed: false }` on failure.
 *
 * @example
 * const guard = await guardAdminRateLimit(interaction, {
 *   action: 'ticket-create',
 *   limit: RateLimits.TICKET_CREATE,
 * });
 * if (!guard.allowed) return;
 */
export async function guardAdminRateLimit(interaction: Interaction, options: GuardOptions): Promise<GuardResult> {
  if (!interaction.isRepliable()) {
    enhancedLogger.warn('guardAdminRateLimit called with non-repliable interaction', LogCategory.COMMAND_EXECUTION);
    return { allowed: false };
  }

  // Admin check
  if (!options.skipAdmin) {
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return { allowed: false };
    }
  }

  // Rate limit check
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const scope = options.scope ?? 'user';

  let key: string;
  switch (scope) {
    case 'guild':
      if (!guildId) return { allowed: false };
      key = createRateLimitKey.guild(guildId, options.action);
      break;
    case 'userGuild':
      if (!guildId) return { allowed: false };
      key = createRateLimitKey.userGuild(userId, guildId, options.action);
      break;
    default:
      key = createRateLimitKey.user(userId, options.action);
  }

  const rateCheck = rateLimiter.check(key, options.limit);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: rateCheck.message || 'Rate limit exceeded. Please try again later.',
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.rateLimit(`Rate limit hit: ${options.action}`, userId, guildId ?? 'unknown');
    return { allowed: false };
  }

  return { allowed: true };
}
