import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import type { StatusLevel } from '../../../typeorm/entities/status';
import {
  createRateLimitKey,
  enhancedLogger,
  escapeDiscordMarkdown,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireBotOwner,
} from '../../../utils';
import type { StatusManager } from '../../../utils/status/StatusManager';

const tl = lang.status;

export async function statusSetHandler(
  interaction: ChatInputCommandInteraction<CacheType>,
  statusManager: StatusManager,
) {
  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Rate limit (5 per hour)
  const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'status-set');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BOT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const level = interaction.options.getString('level', true) as StatusLevel;
  const message = interaction.options.getString('message') || undefined;
  const systemsRaw = interaction.options.getString('systems') || undefined;
  const systems = systemsRaw
    ? systemsRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map(s => escapeDiscordMarkdown(s))
    : undefined;

  try {
    await statusManager.setStatus(level, interaction.user.id, message, systems);

    const levelLabel = tl.levels[level] || level;
    await interaction.reply({
      content: tl.set.success.replace('{level}', levelLabel),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Status manually set via command', LogCategory.COMMAND_EXECUTION, {
      level,
      userId: interaction.user.id,
      message,
      systems,
    });
  } catch (error) {
    enhancedLogger.error('Failed to set status', error as Error, LogCategory.COMMAND_EXECUTION);
    await interaction.reply({
      content: tl.set.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
