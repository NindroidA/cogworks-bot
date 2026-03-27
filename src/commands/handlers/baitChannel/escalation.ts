import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';
import { Colors } from '../../../utils/colors';

const tl = lang.baitChannel;

export const escalationHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
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
        config.enableEscalation = true;
        await safeDbOperation(() => configRepo.save(config), 'Save escalation config');
        (client as ExtendedClient).baitChannelManager?.clearConfigCache(interaction.guildId!);

        const embed = new EmbedBuilder()
          .setColor(Colors.status.success)
          .setTitle(tl.escalation.enabled)
          .setDescription(tl.escalation.enabledDescription)
          .addFields({
            name: tl.escalation.currentThresholds,
            value: [
              `**Log Only:** ${config.escalationLogThreshold}+`,
              `**Timeout:** ${config.escalationTimeoutThreshold}+`,
              `**Kick:** ${config.escalationKickThreshold}+`,
              `**Ban:** ${config.escalationBanThreshold}+`,
            ].join('\n'),
          });

        await interaction.reply({
          embeds: [embed],
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      case 'disable': {
        config.enableEscalation = false;
        await safeDbOperation(() => configRepo.save(config), 'Save escalation config');
        (client as ExtendedClient).baitChannelManager?.clearConfigCache(interaction.guildId!);

        await interaction.reply({
          content: `${tl.escalation.disabled} Current fixed action: **${config.actionType}**`,
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      case 'thresholds': {
        const logThreshold = interaction.options.getInteger('log');
        const timeoutThreshold = interaction.options.getInteger('timeout');
        const kickThreshold = interaction.options.getInteger('kick');
        const banThreshold = interaction.options.getInteger('ban');

        // Merge provided values with existing
        const newLog = logThreshold ?? config.escalationLogThreshold;
        const newTimeout = timeoutThreshold ?? config.escalationTimeoutThreshold;
        const newKick = kickThreshold ?? config.escalationKickThreshold;
        const newBan = banThreshold ?? config.escalationBanThreshold;

        // Validate strictly ascending
        if (!(newLog < newTimeout && newTimeout < newKick && newKick < newBan)) {
          await interaction.reply({
            content: `${tl.escalation.invalidThresholds}\nCurrent values: log=${newLog}, timeout=${newTimeout}, kick=${newKick}, ban=${newBan}`,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        config.escalationLogThreshold = newLog;
        config.escalationTimeoutThreshold = newTimeout;
        config.escalationKickThreshold = newKick;
        config.escalationBanThreshold = newBan;

        await safeDbOperation(() => configRepo.save(config), 'Save escalation thresholds');
        (client as ExtendedClient).baitChannelManager?.clearConfigCache(interaction.guildId!);

        const updated: string[] = [];
        if (logThreshold !== null) updated.push('log');
        if (timeoutThreshold !== null) updated.push('timeout');
        if (kickThreshold !== null) updated.push('kick');
        if (banThreshold !== null) updated.push('ban');

        const embed = new EmbedBuilder()
          .setColor(Colors.status.success)
          .setTitle(tl.escalation.thresholdsUpdated)
          .addFields({
            name: tl.escalation.currentThresholds,
            value: [
              `**Log Only:** ${newLog}+${logThreshold !== null ? ' ✏️' : ''}`,
              `**Timeout:** ${newTimeout}+${timeoutThreshold !== null ? ' ✏️' : ''}`,
              `**Kick:** ${newKick}+${kickThreshold !== null ? ' ✏️' : ''}`,
              `**Ban:** ${newBan}+${banThreshold !== null ? ' ✏️' : ''}`,
            ].join('\n'),
          });

        await interaction.reply({
          embeds: [embed],
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
    await handleInteractionError(interaction, error, 'Failed to update escalation settings');
  }
};
