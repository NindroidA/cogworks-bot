/**
 * "Open Ticket For User" — User Context Menu Command
 *
 * Right-click a user → Open Ticket For User → Shows ticket types and guides staff
 */

import { EmbedBuilder, MessageFlags, type UserContextMenuCommandInteraction } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import {
  enhancedLogger,
  escapeDiscordMarkdown,
  handleInteractionError,
  LogCategory,
  lang,
  requireAdmin,
} from '../../../utils';
import { Colors } from '../../../utils/colors';

export async function openTicketForUserHandler(interaction: UserContextMenuCommandInteraction): Promise<void> {
  try {
    const adminCheck = requireAdmin(interaction as any);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guildId!;
    const targetUser = interaction.targetUser;

    // Check ticket config
    const configRepo = AppDataSource.getRepository(TicketConfig);
    const config = await configRepo.findOneBy({ guildId });

    if (!config) {
      await interaction.reply({
        content: lang.general.contextMenu.ticketNotConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Get available ticket types
    const typeRepo = AppDataSource.getRepository(CustomTicketType);
    const ticketTypes = await typeRepo.find({
      where: { guildId, isActive: true },
      order: { sortOrder: 'ASC', displayName: 'ASC' },
    });

    if (ticketTypes.length === 0) {
      await interaction.reply({
        content: lang.general.contextMenu.noTicketTypes,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const typeList = ticketTypes
      .map(t => `${t.emoji || '🎫'} **${escapeDiscordMarkdown(t.displayName)}** (\`${t.typeId}\`)`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(Colors.status.info)
      .setTitle(`Open Ticket for ${targetUser.displayName}`)
      .setDescription(
        `To open a ticket for this user, go to the ticket channel (<#${config.channelId}>) and use the ticket creation button.\n\n` +
          `**Available types:**\n${typeList}\n\n` +
          `**Target user:** ${targetUser.toString()} (${targetUser.id})`,
      )
      .setThumbnail(targetUser.displayAvatarURL());

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Open ticket for user context menu used', LogCategory.COMMAND_EXECUTION, {
      guildId,
      staffUserId: interaction.user.id,
      targetUserId: targetUser.id,
    });
  } catch (error) {
    await handleInteractionError(interaction as any, error, 'Open ticket for user context menu');
  }
}
