import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { handleInteractionError, lang, safeDbOperation, sanitizeUserInput } from '../../../utils';
import { Colors } from '../../../utils/colors';

const tl = lang.baitChannel;

export async function dmNotifyHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const subcommand = interaction.options.getSubcommand();
    const configRepo = AppDataSource.getRepository(BaitChannelConfig);

    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await interaction.reply({
        content: tl.notConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    switch (subcommand) {
      case 'enable': {
        config.dmBeforeAction = true;
        await safeDbOperation(() => configRepo.save(config), 'Save DM config');
        (client as ExtendedClient).baitChannelManager?.clearConfigCache(interaction.guildId!);

        await interaction.reply({
          content: tl.dmNotify.enabled,
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      case 'disable': {
        config.dmBeforeAction = false;
        await safeDbOperation(() => configRepo.save(config), 'Save DM config');
        (client as ExtendedClient).baitChannelManager?.clearConfigCache(interaction.guildId!);

        await interaction.reply({
          content: tl.dmNotify.disabled,
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      case 'appeal-info': {
        const text = sanitizeUserInput(interaction.options.getString('text', true));

        if (text.length > 500) {
          await interaction.reply({
            content: tl.dmNotify.appealTooLong,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        config.appealInfo = text;
        await safeDbOperation(() => configRepo.save(config), 'Save appeal info');
        (client as ExtendedClient).baitChannelManager?.clearConfigCache(interaction.guildId!);

        const embed = new EmbedBuilder().setColor(Colors.status.success).setTitle(tl.dmNotify.appealSet).addFields({
          name: 'Appeal Information',
          value: text,
        });

        await interaction.reply({
          embeds: [embed],
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      case 'clear-appeal': {
        config.appealInfo = null;
        await safeDbOperation(() => configRepo.save(config), 'Clear appeal info');
        (client as ExtendedClient).baitChannelManager?.clearConfigCache(interaction.guildId!);

        await interaction.reply({
          content: tl.dmNotify.appealCleared,
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      default:
        await interaction.reply({
          content: lang.errors.unknownSubcommand,
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to update DM notification settings');
  }
}
