/**
 * `/baitchannel raid {status|enter|release}` handler.
 *
 * Routes to the singleton `RaidModeManager` which owns the state machine
 * + permission overwrites. The handler does light input/permission
 * checks, then defers and replies.
 */

import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { guardFeatureAccess, handleInteractionError } from '../../../utils';
import { getRaidModeManager } from '../../../utils/baitChannel/raidModeManager';
import { Colors } from '../../../utils/colors';

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
      content: '❌ Raid mode manager is not initialized (bot may still be starting up).',
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
          .setTitle(status.active ? '🚨 Raid mode is ACTIVE' : '✅ Raid mode is inactive')
          .addFields(
            {
              name: 'Recent triggers',
              value: `${status.triggerCount} within window`,
              inline: true,
            },
            {
              name: 'Distinct offenders',
              value: `${status.recentOffenderIds.length}`,
              inline: true,
            },
          );
        if (status.active && status.until) {
          embed.addFields({
            name: 'Auto-release at',
            value: `<t:${Math.floor(status.until.getTime() / 1000)}:f>`,
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
          await interaction.editReply(
            '❌ Bait channel is not configured for this guild. Run `/baitchannel setup` first.',
          );
          return;
        }
        if (config.currentRaidModeUntil && config.currentRaidModeUntil.getTime() > Date.now()) {
          await interaction.editReply('⚠️ Raid mode is already active. Use `/baitchannel raid release` first to reset.');
          return;
        }
        await mgr.enterRaidMode(interaction.guild, config);
        await interaction.editReply(`✅ Raid mode activated. Reason: ${reason}`);
        return;
      }

      case 'release': {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const released = await mgr.releaseRaidMode(
          interaction.guild,
          interaction.user.id,
          'manual release via slash command',
        );
        await interaction.editReply(
          released ? '✅ Raid mode released. Channel permissions restored.' : 'ℹ️ Raid mode was not active.',
        );
        return;
      }

      default:
        await interaction.reply({ content: 'Unknown raid subcommand.', flags: [MessageFlags.Ephemeral] });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to handle raid command');
  }
}
