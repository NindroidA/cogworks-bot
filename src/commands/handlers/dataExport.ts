/**
 * Data Export Command Handler
 *
 * GDPR Compliance: Exports all guild data to JSON
 * Security: Admin-only, rate limited to 1 per 24 hours
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../typeorm';
// Import all entities
import { AnnouncementConfig } from '../../typeorm/entities/announcement/AnnouncementConfig';
import { Application } from '../../typeorm/entities/application/Application';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { Position } from '../../typeorm/entities/application/Position';
import { BaitChannelConfig } from '../../typeorm/entities/BaitChannelConfig';
import { BaitChannelLog } from '../../typeorm/entities/BaitChannelLog';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { UserActivity } from '../../typeorm/entities/UserActivity';
import {
  createRateLimitKey,
  LANGF,
  lang,
  logger,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../utils';

/**
 * Handle data export command
 * Exports all guild data to JSON and sends via DM
 */
export const dataExportHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> => {
  try {
    const tl = lang.dataExport;
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: tl.guildOnly,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check admin permission
    const permissionCheck = requireAdmin(interaction);
    if (!permissionCheck.allowed) {
      await interaction.reply({
        content: permissionCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check rate limit
    const rateLimitKey = createRateLimitKey.guild(guildId, 'data-export');
    const rateLimit = rateLimiter.check(rateLimitKey, RateLimits.DATA_EXPORT);

    if (!rateLimit.allowed) {
      await interaction.reply({
        content: rateLimit.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Defer reply as export may take time
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    logger(LANGF(tl.starting, guildId, interaction.user.tag), 'INFO');

    // Collect all data
    const exportData: Record<string, unknown[]> = {};

    // Bot Configuration
    const botConfigRepo = AppDataSource.getRepository(BotConfig);
    exportData.botConfig = await botConfigRepo.find({ where: { guildId } });

    // Bait Channel
    const baitChannelConfigRepo = AppDataSource.getRepository(BaitChannelConfig);
    const baitChannelLogRepo = AppDataSource.getRepository(BaitChannelLog);
    exportData.baitChannelConfig = await baitChannelConfigRepo.find({ where: { guildId } });
    exportData.baitChannelLogs = await baitChannelLogRepo.find({ where: { guildId } });

    // Saved Roles
    const savedRoleRepo = AppDataSource.getRepository(SavedRole);
    exportData.savedRoles = await savedRoleRepo.find({ where: { guildId } });

    // Announcements
    const announcementConfigRepo = AppDataSource.getRepository(AnnouncementConfig);
    exportData.announcementConfig = await announcementConfigRepo.find({ where: { guildId } });

    // Applications
    const applicationRepo = AppDataSource.getRepository(Application);
    const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
    const positionRepo = AppDataSource.getRepository(Position);
    const archivedApplicationRepo = AppDataSource.getRepository(ArchivedApplication);
    const archivedApplicationConfigRepo = AppDataSource.getRepository(ArchivedApplicationConfig);

    exportData.applications = await applicationRepo.find({ where: { guildId } });
    exportData.applicationConfig = await applicationConfigRepo.find({ where: { guildId } });
    exportData.positions = await positionRepo.find({ where: { guildId } });
    exportData.archivedApplications = await archivedApplicationRepo.find({ where: { guildId } });
    exportData.archivedApplicationConfig = await archivedApplicationConfigRepo.find({
      where: { guildId },
    });

    // Tickets
    const ticketRepo = AppDataSource.getRepository(Ticket);
    const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
    const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);
    const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);

    exportData.tickets = await ticketRepo.find({ where: { guildId } });
    exportData.ticketConfig = await ticketConfigRepo.find({ where: { guildId } });
    exportData.archivedTickets = await archivedTicketRepo.find({ where: { guildId } });
    exportData.archivedTicketConfig = await archivedTicketConfigRepo.find({ where: { guildId } });

    // User Activity
    const userActivityRepo = AppDataSource.getRepository(UserActivity);
    exportData.userActivity = await userActivityRepo.find({ where: { guildId } });

    // Calculate total records
    const totalRecords = Object.values(exportData).reduce((sum, arr) => sum + arr.length, 0);

    // Create export metadata
    const exportMetadata = {
      exportedAt: new Date().toISOString(),
      guildId: guildId,
      guildName: interaction.guild?.name || 'Unknown',
      requestedBy: {
        id: interaction.user.id,
        tag: interaction.user.tag,
      },
      totalRecords: totalRecords,
      tables: Object.keys(exportData).length,
      recordCounts: Object.fromEntries(
        Object.entries(exportData).map(([key, arr]) => [key, arr.length]),
      ),
    };

    const fullExport = {
      metadata: exportMetadata,
      data: exportData,
    };

    // Create temporary directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Write to file
    const filename = `guild-${guildId}-export-${Date.now()}.json`;
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(fullExport, null, 2));

    logger(
      LANGF(tl.completed, totalRecords.toString(), Object.keys(exportData).length.toString()),
      'INFO',
    );

    // Send file via DM
    try {
      const dmChannel = await interaction.user.createDM();

      const embed = new EmbedBuilder()
        .setTitle(tl.exportTitle)
        .setDescription(LANGF(tl.exportDescription, interaction.guild?.name || 'Unknown'))
        .addFields(
          { name: tl.totalRecords, value: totalRecords.toString(), inline: true },
          { name: tl.tables, value: Object.keys(exportData).length.toString(), inline: true },
          { name: tl.exportedAt, value: new Date().toLocaleString(), inline: true },
        )
        .setColor(0x00ff00)
        .setFooter({ text: tl.footer })
        .setTimestamp();

      await dmChannel.send({
        embeds: [embed],
        files: [{ attachment: filepath, name: filename }],
      });

      // Delete temp file
      fs.unlinkSync(filepath);

      await interaction.editReply({
        content: tl.dmSuccess,
      });
    } catch (dmError) {
      logger(LANGF(tl.dmFailedLog, interaction.user.tag, (dmError as Error).message), 'WARN');

      // Fallback: offer file in channel
      await interaction.editReply({
        content: tl.dmFailed,
      });
    }
  } catch (error) {
    logger(`Error in data export: ${(error as Error).message}`, 'ERROR');

    const errorContent = lang.dataExport.error;

    if (interaction.deferred) {
      await interaction.editReply({ content: errorContent });
    } else {
      await interaction.reply({
        content: errorContent,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
};
