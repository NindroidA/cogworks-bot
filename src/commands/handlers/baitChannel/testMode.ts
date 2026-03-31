import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';
import { Colors } from '../../../utils/colors';

const tl = lang.baitChannel;

export const testModeHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const enabled = interaction.options.getBoolean('enabled', true);

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await interaction.reply({
        content: tl.setupFirst,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    config.testMode = enabled;
    await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

    // Clear cache
    const { baitChannelManager } = client as ExtendedClient;
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(interaction.guildId!);
    }

    const embed = new EmbedBuilder()
      .setColor(enabled ? Colors.status.info : Colors.status.success)
      .setTitle(tl.testMode.title)
      .setDescription(enabled ? tl.testMode.enabled : tl.testMode.disabled);

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.testMode);
  }
};
