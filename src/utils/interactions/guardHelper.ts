/**
 * Permission + Rate Limit Guard Helper
 *
 * Combines the admin permission check and rate limit check into a single call.
 * Replies with the appropriate error message and returns { allowed: false } on failure.
 */

import { type Interaction, MessageFlags } from 'discord.js';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { createRateLimitKey, type RateLimitConfig, rateLimiter } from '../security/rateLimiter';
import { type Feature, hasFeatureAccess, type Level } from '../validation/featurePermission';
import { requireAdmin, requireBotOwner } from '../validation/permissionValidator';

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
  /**
   * Skip the permission check (admin OR feature) and run only the rate limit
   * pass. Used by handlers that have already gated permission upstream — e.g.
   * a modal submit whose triggering button was guarded.
   */
  skipPermissionCheck?: boolean;
}

/**
 * Internal helper: perform the rate limit half of a combined guard.
 * Replies ephemerally on rate-limit hit and returns the result.
 */
async function applyRateLimit(interaction: Interaction, options: GuardOptions): Promise<GuardResult> {
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
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: rateCheck.message || 'Rate limit exceeded. Please try again later.',
        flags: [MessageFlags.Ephemeral],
      });
    }
    enhancedLogger.rateLimit(`Rate limit hit: ${options.action}`, userId, guildId ?? 'unknown');
    return { allowed: false };
  }

  return { allowed: true };
}

/**
 * Admin permission guard (no rate limiting).
 * Replies with an ephemeral error and returns `{ allowed: false }` on failure.
 *
 * @example
 * const guard = await guardAdmin(interaction);
 * if (!guard.allowed) return;
 */
export async function guardAdmin(interaction: Interaction): Promise<GuardResult> {
  if (!interaction.isRepliable()) {
    return { allowed: false };
  }

  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return { allowed: false };
  }

  return { allowed: true };
}

/**
 * Bot-owner guard (no rate limiting). Mirrors `guardAdmin`'s shape: replies
 * ephemerally on failure and returns `{ allowed: false }`. Use for owner-only
 * operations (status commands, dev tools) instead of hand-rolling the
 * `BOT_OWNER_ID` check.
 *
 * @example
 * const guard = await guardOwner(interaction);
 * if (!guard.allowed) return;
 */
export async function guardOwner(interaction: Interaction): Promise<GuardResult> {
  if (!interaction.isRepliable()) {
    return { allowed: false };
  }

  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return { allowed: false };
  }

  return { allowed: true };
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

  if (!options.skipPermissionCheck) {
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return { allowed: false };
    }
  }

  return applyRateLimit(interaction, options);
}

/**
 * Feature-based permission guard (v3.1.3).
 *
 * Replies with an ephemeral error and returns `{ allowed: false }` on failure,
 * mirroring `guardAdmin` so handlers can swap one for the other as features
 * migrate to the new system. Unconfigured guilds fall back to admin-only.
 *
 * @example
 * const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
 * if (!guard.allowed) return;
 */
export async function guardFeatureAccess(
  interaction: Interaction,
  feature: Feature,
  requiredLevel: Level,
): Promise<GuardResult> {
  if (!interaction.isRepliable()) return { allowed: false };

  const result = await hasFeatureAccess(interaction, feature, requiredLevel);
  if (!result.allowed) {
    await interaction.reply({
      content: result.message ?? "❌ You don't have permission to use this command.",
      flags: [MessageFlags.Ephemeral],
    });
    return { allowed: false };
  }

  return { allowed: true };
}

/**
 * Combined feature-permission + rate limit guard.
 * Drop-in replacement for `guardAdminRateLimit` once a handler has been
 * migrated to the v3.1.3 feature permission system. Same return shape and
 * options. Unconfigured guilds still fall back to admin-only via
 * `hasFeatureAccess`.
 *
 * @example
 * const guard = await guardFeatureRateLimit(interaction, 'memory', 'manage', {
 *   action: 'memory-add',
 *   limit: RateLimits.MEMORY_ADD,
 * });
 * if (!guard.allowed) return;
 */
export async function guardFeatureRateLimit(
  interaction: Interaction,
  feature: Feature,
  requiredLevel: Level,
  options: GuardOptions,
): Promise<GuardResult> {
  if (!interaction.isRepliable()) {
    enhancedLogger.warn('guardFeatureRateLimit called with non-repliable interaction', LogCategory.COMMAND_EXECUTION);
    return { allowed: false };
  }

  if (!options.skipPermissionCheck) {
    const featureCheck = await hasFeatureAccess(interaction, feature, requiredLevel);
    if (!featureCheck.allowed) {
      await interaction.reply({
        content: featureCheck.message ?? "❌ You don't have permission to use this command.",
        flags: [MessageFlags.Ephemeral],
      });
      return { allowed: false };
    }
  }

  return applyRateLimit(interaction, options);
}
