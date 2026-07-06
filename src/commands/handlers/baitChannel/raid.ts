/**
 * `/baitchannel raid {status|enter|release}` handler.
 *
 * Routes to the singleton `RaidModeManager` which owns the state machine
 * + permission overwrites. The handler does light input/permission
 * checks, then defers and replies.
 */

import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { formatLang, guardFeatureAccess, handleInteractionError, lang, toUnixSeconds } from '../../../utils';
import { getRaidModeManager } from '../../../utils/baitChannel/raidModeManager';
import { Colors } from '../../../utils/colors';

const tl = lang.baitChannel.raid;

export async function raidHandler(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  // 'enter' and 'release' are destructive — require admin-level feature
  // access. 'status' is read-only — manage level is enough.
  const level = subcommand === 'status' ? 'manage' : 'admin';
  const guard = await guardFeatureAccess(interaction, 'baitchannel', level);
  if (!guard.allowed) return;

  const mgr = getRaidModeManager();
  if (!mgr) {
    await interaction.reply({
      content: tl.notInitialized,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!interaction.guild) return;

  try {
    switch (subcommand) {
      case 'status': {
        const status = await mgr.getStatus(interaction.guildId!);
        const embed = new EmbedBuilder()
          .setColor(status.active ? Colors.status.error : Colors.status.success)
          .setTitle(status.active ? tl.statusActive : tl.statusInactive)
          .addFields(
            {
              name: tl.recentTriggers,
              value: formatLang(tl.withinWindow, status.triggerCount),
              inline: true,
            },
            {
              name: tl.distinctOffenders,
              value: `${status.recentOffenderIds.length}`,
              inline: true,
            },
          );
        if (status.active && status.until) {
          embed.addFields({
            name: tl.autoReleaseAt,
            value: `<t:${toUnixSeconds(status.until)}:f>`,
            inline: false,
          });
        }
        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        return;
      }

      case 'enter': {
        // Manual entry — load config, then ask the manager to enter.
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const reason = interaction.options.getString('reason') ?? 'manually triggered';
        // Pull a fresh config row — manager.enterRaidMode reads + writes it.
        const { AppDataSource } = await import('../../../typeorm');
        const { BaitChannelConfig } = await import('../../../typeorm/entities/bait/BaitChannelConfig');
        const config = await AppDataSource.getRepository(BaitChannelConfig).findOne({
          where: { guildId: interaction.guildId! },
        });
        if (!config) {
          await interaction.editReply(tl.notConfigured);
          return;
        }
        if (config.currentRaidModeUntil && config.currentRaidModeUntil.getTime() > Date.now()) {
          await interaction.editReply(tl.alreadyActive);
          return;
        }
        await mgr.enterRaidMode(interaction.guild, config);
        await interaction.editReply(formatLang(tl.activated, reason));
        return;
      }

      case 'release': {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const released = await mgr.releaseRaidMode(
          interaction.guild,
          interaction.user.id,
          'manual release via slash command',
        );
        await interaction.editReply(released ? tl.released : tl.notActive);
        return;
      }

      default:
        await interaction.reply({ content: tl.unknownSubcommand, flags: [MessageFlags.Ephemeral] });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error);
  }
}
