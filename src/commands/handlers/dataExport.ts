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
import { MoreThanOrEqual } from 'typeorm';
import { AppDataSource } from '../../typeorm';
// Import all entities
import { AuditLog } from '../../typeorm/entities/AuditLog';
import { AnalyticsConfig } from '../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../typeorm/entities/analytics/AnalyticsSnapshot';
import { AnnouncementConfig } from '../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from '../../typeorm/entities/announcement/AnnouncementLog';
import { AnnouncementTemplate } from '../../typeorm/entities/announcement/AnnouncementTemplate';
import { Application } from '../../typeorm/entities/application/Application';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { Position } from '../../typeorm/entities/application/Position';
import { BaitChannelConfig } from '../../typeorm/entities/BaitChannelConfig';
import { BaitChannelLog } from '../../typeorm/entities/BaitChannelLog';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { BaitKeyword } from '../../typeorm/entities/bait/BaitKeyword';
import { JoinEvent } from '../../typeorm/entities/bait/JoinEvent';
import { EventConfig } from '../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../../typeorm/entities/event/EventTemplate';
import { ImportLog } from '../../typeorm/entities/import/ImportLog';
import { MemoryConfig } from '../../typeorm/entities/memory/MemoryConfig';
import { MemoryItem } from '../../typeorm/entities/memory/MemoryItem';
import { MemoryTag } from '../../typeorm/entities/memory/MemoryTag';
import { OnboardingCompletion } from '../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../typeorm/entities/onboarding/OnboardingConfig';
import { PendingBan } from '../../typeorm/entities/PendingBan';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { RulesConfig } from '../../typeorm/entities/rules/RulesConfig';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import { StarboardConfig } from '../../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../../typeorm/entities/starboard/StarboardEntry';
import { BotStatus } from '../../typeorm/entities/status/BotStatus';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { UserTicketRestriction } from '../../typeorm/entities/ticket/UserTicketRestriction';
import { UserActivity } from '../../typeorm/entities/UserActivity';
import { XPConfig } from '../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../typeorm/entities/xp/XPUser';
import { enhancedLogger, guardAdminRateLimit, LANGF, LogCategory, lang, RateLimits } from '../../utils';

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

    const guard = await guardAdminRateLimit(interaction, {
      action: 'data-export',
      limit: RateLimits.DATA_EXPORT,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    // Defer reply as export may take time
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    enhancedLogger.info(LANGF(tl.starting, guildId, interaction.user.tag), LogCategory.COMMAND_EXECUTION);

    // Collect all data in parallel for performance
    const [
      botConfig,
      baitChannelConfig,
      baitChannelLogs,
      savedRoles,
      announcementConfig,
      applications,
      applicationConfig,
      positions,
      archivedApplications,
      archivedApplicationConfig,
      tickets,
      ticketConfig,
      archivedTickets,
      archivedTicketConfig,
      customTicketTypes,
      userTicketRestrictions,
      rulesConfig,
      reactionRoleMenus,
      pendingBans,
      announcementLogs,
      memoryConfig,
      memoryItems,
      memoryTags,
      botStatus,
      userActivity,
      auditLogs,
      announcementTemplates,
      baitKeywords,
      importLogs,
      joinEvents,
      starboardConfig,
      starboardEntries,
      xpConfig,
      xpUsers,
      xpRoleRewards,
      eventConfig,
      eventTemplates,
      eventReminders,
      analyticsConfig,
      analyticsSnapshots,
      onboardingConfig,
      onboardingCompletions,
    ] = await Promise.all([
      AppDataSource.getRepository(BotConfig).find({ where: { guildId } }),
      AppDataSource.getRepository(BaitChannelConfig).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(BaitChannelLog).find({ where: { guildId } }),
      AppDataSource.getRepository(SavedRole).find({ where: { guildId } }),
      AppDataSource.getRepository(AnnouncementConfig).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(Application).find({ where: { guildId } }),
      AppDataSource.getRepository(ApplicationConfig).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(Position).find({ where: { guildId } }),
      AppDataSource.getRepository(ArchivedApplication).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(ArchivedApplicationConfig).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(Ticket).find({ where: { guildId } }),
      AppDataSource.getRepository(TicketConfig).find({ where: { guildId } }),
      AppDataSource.getRepository(ArchivedTicket).find({ where: { guildId } }),
      AppDataSource.getRepository(ArchivedTicketConfig).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(CustomTicketType).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(UserTicketRestriction).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(RulesConfig).find({ where: { guildId } }),
      AppDataSource.getRepository(ReactionRoleMenu).find({
        where: { guildId },
        relations: ['options'],
      }),
      AppDataSource.getRepository(PendingBan).find({ where: { guildId } }),
      AppDataSource.getRepository(AnnouncementLog).find({ where: { guildId } }),
      AppDataSource.getRepository(AnnouncementTemplate).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(MemoryConfig).find({ where: { guildId } }),
      AppDataSource.getRepository(MemoryItem).find({ where: { guildId } }),
      AppDataSource.getRepository(MemoryTag).find({ where: { guildId } }),
      AppDataSource.getRepository(BotStatus).find(),
      AppDataSource.getRepository(UserActivity).find({ where: { guildId } }),
      AppDataSource.getRepository(AuditLog).find({ where: { guildId } }),
      AppDataSource.getRepository(BaitKeyword).find({ where: { guildId } }),
      AppDataSource.getRepository(ImportLog).find({ where: { guildId } }),
      AppDataSource.getRepository(JoinEvent).find({
        where: {
          guildId,
          joinedAt: MoreThanOrEqual(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
        },
      }),
      AppDataSource.getRepository(StarboardConfig).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(StarboardEntry).find({
        where: { guildId },
      }),
      // New v3 features
      AppDataSource.getRepository(XPConfig).find({ where: { guildId } }),
      AppDataSource.getRepository(XPUser).find({ where: { guildId } }),
      AppDataSource.getRepository(XPRoleReward).find({ where: { guildId } }),
      AppDataSource.getRepository(EventConfig).find({ where: { guildId } }),
      AppDataSource.getRepository(EventTemplate).find({ where: { guildId } }),
      AppDataSource.getRepository(EventReminder).find({ where: { guildId } }),
      AppDataSource.getRepository(AnalyticsConfig).find({ where: { guildId } }),
      AppDataSource.getRepository(AnalyticsSnapshot).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(OnboardingConfig).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(OnboardingCompletion).find({
        where: { guildId },
      }),
    ]);

    const exportData: Record<string, unknown[]> = {
      botConfig,
      baitChannelConfig,
      baitChannelLogs,
      savedRoles,
      announcementConfig,
      applications,
      applicationConfig,
      positions,
      archivedApplications,
      archivedApplicationConfig,
      tickets,
      ticketConfig,
      archivedTickets,
      archivedTicketConfig,
      customTicketTypes,
      userTicketRestrictions,
      rulesConfig,
      reactionRoleMenus,
      reactionRoleOptions: reactionRoleMenus.flatMap(m => m.options || []),
      pendingBans,
      announcementLogs,
      announcementTemplates,
      memoryConfig,
      memoryItems,
      memoryTags,
      botStatus,
      userActivity,
      auditLogs,
      baitKeywords,
      importLogs,
      joinEvents,
      starboardConfig,
      starboardEntries,
      xpConfig,
      xpUsers,
      xpRoleRewards,
      eventConfig,
      eventTemplates,
      eventReminders,
      analyticsConfig,
      analyticsSnapshots,
      onboardingConfig,
      onboardingCompletions,
    };

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
      recordCounts: Object.fromEntries(Object.entries(exportData).map(([key, arr]) => [key, arr.length])),
    };

    const fullExport = {
      metadata: exportMetadata,
      data: exportData,
    };

    // Create temporary directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Write to file
    const filename = `guild-${guildId}-export-${Date.now()}.json`;
    const filepath = path.join(tempDir, filename);
    await fs.promises.writeFile(filepath, JSON.stringify(fullExport, null, 2));

    enhancedLogger.info(
      LANGF(tl.completed, totalRecords.toString(), Object.keys(exportData).length.toString()),
      LogCategory.COMMAND_EXECUTION,
    );

    // Send file via DM
    try {
      const dmChannel = await interaction.user.createDM();

      const embed = new EmbedBuilder()
        .setTitle(tl.exportTitle)
        .setDescription(LANGF(tl.exportDescription, interaction.guild?.name || 'Unknown'))
        .addFields(
          {
            name: tl.totalRecords,
            value: totalRecords.toString(),
            inline: true,
          },
          {
            name: tl.tables,
            value: Object.keys(exportData).length.toString(),
            inline: true,
          },
          {
            name: tl.exportedAt,
            value: new Date().toLocaleString(),
            inline: true,
          },
        )
        .setColor(0x00ff00)
        .setFooter({ text: tl.footer });

      await dmChannel.send({
        embeds: [embed],
        files: [{ attachment: filepath, name: filename }],
      });

      // Delete temp file
      await fs.promises.unlink(filepath).catch(() => null);

      await interaction.editReply({
        content: tl.dmSuccess,
      });
    } catch (dmError) {
      // Clean up temp file on DM failure
      await fs.promises.unlink(filepath).catch(() => null);

      enhancedLogger.warn(
        LANGF(tl.dmFailedLog, interaction.user.tag, (dmError as Error).message),
        LogCategory.COMMAND_EXECUTION,
      );

      // Fallback: offer file in channel
      await interaction.editReply({
        content: tl.dmFailed,
      });
    }
  } catch (error) {
    enhancedLogger.error(`Error in data export: ${(error as Error).message}`, undefined, LogCategory.COMMAND_EXECUTION);

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
