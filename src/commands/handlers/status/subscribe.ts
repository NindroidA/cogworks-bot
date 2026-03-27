import { type CacheType, ChannelType, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BotStatus } from '../../../typeorm/entities/status';
import { enhancedLogger, LogCategory, lang, requireBotOwner } from '../../../utils';
import type { StatusManager } from '../../../utils/status/StatusManager';

const tl = lang.status;

/**
 * `/status subscribe <channel>` — Subscribe a channel to status updates.
 * This sets the STATUS_CHANNEL_ID equivalent in the BotStatus singleton,
 * which the StatusManager reads when posting updates.
 *
 * Note: For simplicity, this updates the env-based STATUS_CHANNEL_ID at runtime.
 * A persistent approach would require a new column, but since this is bot-owner only
 * and the env var is already used by StatusManager, we update process.env directly.
 */
export async function statusSubscribeHandler(
  interaction: ChatInputCommandInteraction<CacheType>,
  _statusManager: StatusManager,
) {
  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const channel = interaction.options.getChannel('channel', true);

    // Validate it's a text channel
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      await interaction.reply({
        content: lang.general.channelNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Update the runtime env var so StatusManager picks it up
    process.env.STATUS_CHANNEL_ID = channel.id;

    await interaction.reply({
      content: tl.subscribe.success.replace('{channel}', `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Status channel subscribed', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      channelId: channel.id,
    });
  } catch (error) {
    enhancedLogger.error('Failed to subscribe status channel', error as Error, LogCategory.COMMAND_EXECUTION);
    await interaction.reply({
      content: tl.subscribe.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

/**
 * `/status unsubscribe` — Remove the status update channel subscription.
 */
export async function statusUnsubscribeHandler(
  interaction: ChatInputCommandInteraction<CacheType>,
  _statusManager: StatusManager,
) {
  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    if (!process.env.STATUS_CHANNEL_ID) {
      await interaction.reply({
        content: tl.subscribe.notSubscribed,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    delete process.env.STATUS_CHANNEL_ID;

    await interaction.reply({
      content: tl.subscribe.removed,
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Status channel unsubscribed', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error('Failed to unsubscribe status channel', error as Error, LogCategory.COMMAND_EXECUTION);
    await interaction.reply({
      content: tl.subscribe.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

/**
 * `/status monitor set <url>` — Set external monitoring page URL.
 */
export async function statusMonitorSetHandler(
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

  try {
    const url = interaction.options.getString('url', true).trim();

    // Validate URL format
    if (!url.startsWith('https://')) {
      await interaction.reply({
        content: tl.monitor.invalid,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const statusRepo = AppDataSource.getRepository(BotStatus);
    const status = await statusManager.getStatus();
    status.externalMonitorUrl = url;
    await statusRepo.save(status);

    await interaction.reply({
      content: tl.monitor.set.replace('{url}', url),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('External monitor URL set', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      url,
    });
  } catch (error) {
    enhancedLogger.error('Failed to set monitor URL', error as Error, LogCategory.COMMAND_EXECUTION);
    await interaction.reply({
      content: tl.monitor.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
