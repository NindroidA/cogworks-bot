import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ArchivedTicket } from '../../../typeorm/entities/ticket/ArchivedTicket';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import {
  enhancedLogger,
  handleInteractionError,
  LogCategory,
  lang,
  requireAdmin,
} from '../../../utils';
import { findManyByGuild } from '../../../utils/database/guildQueries';

/**
 * Bulk close all active tickets in the server
 * Admin-only command for testing/cleanup
 */
export async function bulkCloseTicketsHandler(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    // Admin-only command
    const ownerCheck = requireAdmin(interaction);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const guildId = interaction.guild.id;
    const ticketRepo = AppDataSource.getRepository(Ticket);

    // Get all open tickets for this guild
    const openTickets = await findManyByGuild(ticketRepo, guildId, {
      where: { status: 'opened' },
    });

    if (openTickets.length === 0) {
      await interaction.editReply(lang.dev.bulkCloseTickets.noTickets);
      return;
    }

    let closedCount = 0;
    let errorCount = 0;

    // Close each ticket
    for (const ticket of openTickets) {
      try {
        // Try to delete the channel
        const channel = await interaction.guild.channels.fetch(ticket.channelId).catch(() => null);

        if (channel) {
          await channel.delete('[DEV] Bulk close tickets');
        }

        // Update ticket status in database
        ticket.status = 'closed';
        await ticketRepo.save(ticket);

        closedCount++;
      } catch (error) {
        errorCount++;
        enhancedLogger.error(
          `Failed to close ticket ${ticket.id}`,
          error as Error,
          LogCategory.COMMAND_EXECUTION,
        );
      }
    }

    await interaction.editReply(
      `${lang.dev.bulkCloseTickets.complete}\n\n` +
        `${lang.dev.bulkCloseTickets.totalTickets.replace('{count}', openTickets.length.toString())}\n` +
        `${lang.dev.bulkCloseTickets.successfullyClosed.replace('{count}', closedCount.toString())}\n` +
        `${lang.dev.bulkCloseTickets.failed.replace('{count}', errorCount.toString())}`,
    );
  } catch (error) {
    await handleInteractionError(interaction, error, 'bulkCloseTicketsHandler');
  }
}

/**
 * Delete a specific archived ticket by user
 * Also deletes the forum post
 */
export async function deleteArchivedTicketHandler(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    // Admin-only command
    const ownerCheck = requireAdmin(interaction);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const user = interaction.options.getUser('user', true);
    const guildId = interaction.guild.id;
    const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);

    const archivedTicket = await archivedTicketRepo.findOne({
      where: { guildId, createdBy: user.id },
    });

    if (!archivedTicket) {
      await interaction.reply({
        content: lang.dev.deleteArchivedTicket.notFound.replace('{user}', user.tag),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Try to delete the forum post
    let forumPostDeleted = false;
    try {
      const channel = await interaction.client.channels.fetch(archivedTicket.messageId);
      if (channel?.isThread()) {
        await channel.delete();
        forumPostDeleted = true;
      }
    } catch (error) {
      enhancedLogger.error('Failed to delete forum post', error as Error, LogCategory.ERROR);
      // Continue anyway to delete database record
    }

    // Delete database record
    await archivedTicketRepo.remove(archivedTicket);

    await interaction.reply({
      content: forumPostDeleted
        ? lang.dev.deleteArchivedTicket.successWithPost.replace('{user}', user.tag)
        : lang.dev.deleteArchivedTicket.successNoPost.replace('{user}', user.tag),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'deleteArchivedTicketHandler');
  }
}

/**
 * Delete ALL archived tickets in the server
 * Also deletes all forum posts
 */
export async function deleteAllArchivedTicketsHandler(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    // Admin-only command
    const ownerCheck = requireAdmin(interaction);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const guildId = interaction.guild.id;
    const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);

    // Get all archived tickets first
    const archivedTickets = await archivedTicketRepo.find({
      where: { guildId },
    });

    let postsDeleted = 0;
    let postsFailed = 0;

    // Delete forum posts
    for (const ticket of archivedTickets) {
      try {
        const channel = await interaction.client.channels.fetch(ticket.messageId);
        if (channel?.isThread()) {
          await channel.delete();
          postsDeleted++;
        }
      } catch (error) {
        postsFailed++;
        enhancedLogger.error(
          `Failed to delete forum post ${ticket.messageId}`,
          error as Error,
          LogCategory.ERROR,
        );
      }
    }

    // Delete database records
    const result = await archivedTicketRepo.delete({ guildId });

    await interaction.editReply(
      `${lang.dev.deleteAllArchivedTickets.complete}\n\n` +
        `${lang.dev.deleteAllArchivedTickets.results}\n` +
        `${lang.dev.deleteAllArchivedTickets.dbRecordsDeleted.replace('{count}', (result.affected || 0).toString())}\n` +
        `${lang.dev.deleteAllArchivedTickets.forumPostsDeleted.replace('{count}', postsDeleted.toString())}\n` +
        `${lang.dev.deleteAllArchivedTickets.forumPostsFailed.replace('{count}', postsFailed.toString())}`,
    );
  } catch (error) {
    await handleInteractionError(interaction, error, 'deleteAllArchivedTicketsHandler');
  }
}
