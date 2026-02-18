import { type CacheType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import {
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireBotOwner,
} from '../../../utils';
import type { StatusManager } from '../../../utils/status/StatusManager';

const tl = lang.status;

export async function statusClearHandler(
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
  const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'status-clear');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BOT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const current = await statusManager.getStatus();
    if (current.level === 'operational') {
      await interaction.reply({
        content: tl.clear.alreadyOperational,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const resolutionMessage = interaction.options.getString('message') || undefined;
    await statusManager.clearStatus(interaction.user.id, resolutionMessage);

    await interaction.reply({
      content: tl.clear.success,
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Status cleared via command', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      resolutionMessage,
    });
  } catch (error) {
    enhancedLogger.error('Failed to clear status', error as Error, LogCategory.COMMAND_EXECUTION);
    await interaction.reply({
      content: tl.clear.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
