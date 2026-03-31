/**
 * "View Bait Score" — User Context Menu Command
 *
 * Right-click a user → View Bait Score → Shows their bait detection score
 */

import { type Client, EmbedBuilder, MessageFlags, type UserContextMenuCommandInteraction } from 'discord.js';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { enhancedLogger, guardAdmin, handleInteractionError, LogCategory, lang } from '../../../utils';
import { Colors } from '../../../utils/colors';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.baitChannel;
const configRepo = lazyRepo(BaitChannelConfig);

export async function viewBaitScoreHandler(
  client: Client,
  interaction: UserContextMenuCommandInteraction,
): Promise<void> {
  try {
    const guard = await guardAdmin(interaction);
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const targetUser = interaction.targetUser;

    // Check bait config
    const config = await configRepo.findOneBy({ guildId });
    if (!config) {
      await interaction.reply({
        content: tl.setupFirst,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Get bait channel manager for score calculation
    const { baitChannelManager } = client as ExtendedClient;
    if (!baitChannelManager) {
      await interaction.reply({
        content: lang.general.contextMenu.baitManagerUnavailable,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Fetch member for guild-specific data
    const member = await interaction.guild!.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({
        content: lang.general.contextMenu.userNotMember,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Build info embed
    const accountAge = Math.floor((Date.now() - targetUser.createdTimestamp) / (1000 * 60 * 60 * 24));
    const memberSince = member.joinedTimestamp ? Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60)) : 0;

    const embed = new EmbedBuilder()
      .setColor(Colors.status.info)
      .setTitle(`Bait Score: ${targetUser.displayName}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: 'Account Age', value: `${accountAge} days`, inline: true },
        { name: 'Member For', value: `${memberSince} minutes`, inline: true },
        {
          name: 'Bot Account',
          value: targetUser.bot ? 'Yes' : 'No',
          inline: true,
        },
        { name: 'Action Type', value: config.actionType, inline: true },
        {
          name: 'Test Mode',
          value: config.testMode ? 'Enabled' : 'Disabled',
          inline: true,
        },
        {
          name: 'Escalation',
          value: config.enableEscalation ? 'Enabled' : 'Disabled',
          inline: true,
        },
      )
      .setFooter({ text: `User ID: ${targetUser.id}` });

    // Check whitelist status
    const isWhitelisted =
      config.whitelistedUsers?.includes(targetUser.id) ||
      member.roles.cache.some(r => config.whitelistedRoles?.includes(r.id));

    if (isWhitelisted) {
      embed.addFields({
        name: 'Whitelist Status',
        value: '✅ Whitelisted (exempt from bait detection)',
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('View bait score context menu used', LogCategory.COMMAND_EXECUTION, {
      guildId,
      userId: interaction.user.id,
      targetUserId: targetUser.id,
    });
  } catch (error) {
    await handleInteractionError(interaction as any, error, 'View bait score context menu');
  }
}
