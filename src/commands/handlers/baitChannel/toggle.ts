import { type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';

const tl = lang.baitChannel;

export async function toggleHandler(client: Client, interaction: ChatInputCommandInteraction) {
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

    config.enabled = enabled;
    await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

    const { baitChannelManager } = client as ExtendedClient;
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(interaction.guildId!);
    }

    await interaction.reply({
      content: enabled ? tl.toggle.enabled : tl.toggle.disabled,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.toggle);
  }
}
