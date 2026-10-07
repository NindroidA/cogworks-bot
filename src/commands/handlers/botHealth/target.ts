/**
 * What every `/bot-health` subcommand resolves first: the server it runs on
 * (the bot owner may name another with `guild-id`), the system option, and the
 * per-server rate-limit slots, which a run the engine fails gives back.
 */
import type { CacheType, ChatInputCommandInteraction, Client, Guild } from 'discord.js';
import { fmt, lang } from '../../../lang';
import { isValidSnowflake } from '../../../utils/api/helpers';
import type { HealthSystem } from '../../../utils/health/types';
import { guardAdminRateLimit } from '../../../utils/interactions/guardHelper';
import { replyEphemeralError } from '../../../utils/interactions/replyHelper';
import { enhancedLogger, LogCategory } from '../../../utils/monitoring/enhancedLogger';
import { createRateLimitKey, type RateLimitConfig, rateLimiter } from '../../../utils/security/rateLimiter';

const tl = lang.health.command;

/** The server to work on: the current one, or for the bot owner the `guild-id` option. Replies and returns null on error. */
export async function resolveTargetGuild(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  isOwner: boolean,
): Promise<Guild | null> {
  const requested = interaction.options.getString('guild-id')?.trim();
  if (!requested) {
    if (!interaction.guild) await replyEphemeralError(interaction, lang.general.cmdGuildNotFound);
    return interaction.guild;
  }
  const valid = isValidSnowflake(requested);
  const guild = isOwner && valid ? client.guilds.cache.get(requested) : undefined;
  if (guild) {
    if (guild.id !== interaction.guildId) {
      enhancedLogger.info('bot-health: owner targeted another server', LogCategory.SECURITY, {
        guildId: guild.id,
        fromGuildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand(),
      });
    }
    return guild;
  }
  let error = fmt(tl.errors.guildNotFound, { guildId: requested });
  if (!isOwner) error = tl.errors.notOwner;
  else if (!valid) error = fmt(tl.errors.invalidGuildId, { guildId: requested });
  await replyEphemeralError(interaction, error);
  return null;
}

/** The `system` option; "all" (or none) means every system. */
export function systemOption(interaction: ChatInputCommandInteraction<CacheType>): HealthSystem | undefined {
  const choice = interaction.options.getString('system');
  return choice && choice !== 'all' ? (choice as HealthSystem) : undefined;
}

export interface GuildLimit {
  action: string;
  limit: RateLimitConfig;
}

/**
 * Takes one slot of each limit for the server, in order. When one is refused
 * (the guard replies), the slots already taken are given back. Returns the
 * keys taken, or null. Non-owners only ever target their own server, so the
 * interaction's guild is the key.
 */
export async function takeGuildSlots(
  interaction: ChatInputCommandInteraction<CacheType>,
  guildId: string,
  limits: readonly GuildLimit[],
): Promise<string[] | null> {
  const taken: string[] = [];
  for (const limit of limits) {
    const rate = await guardAdminRateLimit(interaction, { ...limit, scope: 'guild', skipPermissionCheck: true });
    if (!rate.allowed) {
      refundSlots(taken);
      return null;
    }
    taken.push(createRateLimitKey.guild(guildId, limit.action));
  }
  return taken;
}

/** Gives back one use of each slot, so a run that never happened doesn't count. */
export function refundSlots(keys: readonly string[]): void {
  for (const key of keys) rateLimiter.refund(key);
}

/** Removes the reply's components once its collector ends. */
export async function removeComponents(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    await interaction.editReply({ components: [] });
  } catch (error) {
    // The reply was dismissed or the token expired; nothing left to tidy.
    enhancedLogger.debug('bot-health: could not remove components', LogCategory.COMMAND_EXECUTION, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
