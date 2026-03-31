/**
 * Bait Channel Weekly Summary Command Handler
 *
 * Enable/disable weekly summary digest and optionally set a channel override.
 */

import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import { handleInteractionError, lang } from '../../../utils';
import { Colors } from '../../../utils/colors';

const tl = lang.baitChannel;

export const summaryHandler = async (_client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const guildId = interaction.guildId!;
    const enabled = interaction.options.getBoolean('enabled', true);
    const channel = interaction.options.getChannel('channel');

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await interaction.reply({
        content: tl.notConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    config.enableWeeklySummary = enabled;
    if (channel) {
      config.summaryChannelId = channel.id;
    } else if (!enabled) {
      // Clear channel override when disabling
      config.summaryChannelId = '';
    }

    await configRepo.save(config);

    const embed = new EmbedBuilder()
      .setTitle(tl.weeklySummary.title)
      .setColor(enabled ? Colors.status.success : Colors.status.neutral)
      .setDescription(enabled ? tl.weeklySummary.enabled : tl.weeklySummary.disabled);

    if (enabled && channel) {
      embed.addFields({
        name: tl.weeklySummary.channelLabel,
        value: `<#${channel.id}>`,
        inline: true,
      });
    } else if (enabled && config.logChannelId) {
      embed.addFields({
        name: tl.weeklySummary.channelLabel,
        value: `<#${config.logChannelId}> (log channel fallback)`,
        inline: true,
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(
      interaction,
      error,
      tl.error.weeklySummary || 'Failed to update weekly summary settings',
    );
  }
};
