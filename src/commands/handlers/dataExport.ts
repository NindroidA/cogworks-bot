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
import { type EntityTarget, type FindManyOptions, MoreThanOrEqual, type ObjectLiteral } from 'typeorm';
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
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../../typeorm/entities/bait/BaitChannelLog';
import { BaitKeyword } from '../../typeorm/entities/bait/BaitKeyword';
import { JoinEvent } from '../../typeorm/entities/bait/JoinEvent';
import { PendingAction } from '../../typeorm/entities/bait/PendingAction';
import { EventConfig } from '../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../../typeorm/entities/event/EventTemplate';
import { ImportLog } from '../../typeorm/entities/import/ImportLog';
import { MemoryConfig } from '../../typeorm/entities/memory/MemoryConfig';
import { MemoryItem } from '../../typeorm/entities/memory/MemoryItem';
import { MemoryTag } from '../../typeorm/entities/memory/MemoryTag';
import { OnboardingCompletion } from '../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../typeorm/entities/onboarding/OnboardingConfig';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { RulesConfig } from '../../typeorm/entities/rules/RulesConfig';
import { StaffRole } from '../../typeorm/entities/StaffRole';
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
import { enhancedLogger, formatLang, guardAdminRateLimit, LogCategory, lang, RateLimits } from '../../utils';

interface ExportEntity {
  /** Output key in the exported JSON's `data` object. */
  name: string;
  entity: EntityTarget<ObjectLiteral>;
  /**
   * Builds the TypeORM FindManyOptions for this entity.
   * Returning `undefined` means "find all" (used by BotStatus, the only
   * non-guild-scoped entity in the export).
   */
  buildFindOptions: (guildId: string) => FindManyOptions<ObjectLiteral> | undefined;
}

const guildScoped = (guildId: string): FindManyOptions<ObjectLiteral> => ({
  where: { guildId },
});

const EXPORT_ENTITIES: ExportEntity[] = [
  { name: 'botConfig', entity: BotConfig, buildFindOptions: guildScoped },
  {
    name: 'baitChannelConfig',
    entity: BaitChannelConfig,
    buildFindOptions: guildScoped,
  },
  {
    name: 'baitChannelLogs',
    entity: BaitChannelLog,
    buildFindOptions: guildScoped,
  },
  { name: 'savedRoles', entity: StaffRole, buildFindOptions: guildScoped },
  {
    name: 'announcementConfig',
    entity: AnnouncementConfig,
    buildFindOptions: guildScoped,
  },
  { name: 'applications', entity: Application, buildFindOptions: guildScoped },
  {
    name: 'applicationConfig',
    entity: ApplicationConfig,
    buildFindOptions: guildScoped,
  },
  { name: 'positions', entity: Position, buildFindOptions: guildScoped },
  {
    name: 'archivedApplications',
    entity: ArchivedApplication,
    buildFindOptions: guildScoped,
  },
  {
    name: 'archivedApplicationConfig',
    entity: ArchivedApplicationConfig,
    buildFindOptions: guildScoped,
  },
  { name: 'tickets', entity: Ticket, buildFindOptions: guildScoped },
  { name: 'ticketConfig', entity: TicketConfig, buildFindOptions: guildScoped },
  {
    name: 'archivedTickets',
    entity: ArchivedTicket,
    buildFindOptions: guildScoped,
  },
  {
    name: 'archivedTicketConfig',
    entity: ArchivedTicketConfig,
    buildFindOptions: guildScoped,
  },
  {
    name: 'customTicketTypes',
    entity: CustomTicketType,
    buildFindOptions: guildScoped,
  },
  {
    name: 'userTicketRestrictions',
    entity: UserTicketRestriction,
    buildFindOptions: guildScoped,
  },
  { name: 'rulesConfig', entity: RulesConfig, buildFindOptions: guildScoped },
  {
    name: 'reactionRoleMenus',
    entity: ReactionRoleMenu,
    buildFindOptions: guildId => ({
      where: { guildId },
      relations: ['options'],
    }),
  },
  {
    name: 'pendingActions',
    entity: PendingAction,
    buildFindOptions: guildScoped,
  },
  {
    name: 'announcementLogs',
    entity: AnnouncementLog,
    buildFindOptions: guildScoped,
  },
  {
    name: 'announcementTemplates',
    entity: AnnouncementTemplate,
    buildFindOptions: guildScoped,
  },
  { name: 'memoryConfig', entity: MemoryConfig, buildFindOptions: guildScoped },
  { name: 'memoryItems', entity: MemoryItem, buildFindOptions: guildScoped },
  { name: 'memoryTags', entity: MemoryTag, buildFindOptions: guildScoped },
  // BotStatus is a singleton, not guild-scoped — undefined means "find all"
  { name: 'botStatus', entity: BotStatus, buildFindOptions: () => undefined },
  { name: 'userActivity', entity: UserActivity, buildFindOptions: guildScoped },
  { name: 'auditLogs', entity: AuditLog, buildFindOptions: guildScoped },
  { name: 'baitKeywords', entity: BaitKeyword, buildFindOptions: guildScoped },
  { name: 'importLogs', entity: ImportLog, buildFindOptions: guildScoped },
  {
    // 90-day retention applies to JoinEvent rows
    name: 'joinEvents',
    entity: JoinEvent,
    buildFindOptions: guildId => ({
      where: {
        guildId,
        joinedAt: MoreThanOrEqual(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
      },
    }),
  },
  {
    name: 'starboardConfig',
    entity: StarboardConfig,
    buildFindOptions: guildScoped,
  },
  {
    name: 'starboardEntries',
    entity: StarboardEntry,
    buildFindOptions: guildScoped,
  },
  { name: 'xpConfig', entity: XPConfig, buildFindOptions: guildScoped },
  { name: 'xpUsers', entity: XPUser, buildFindOptions: guildScoped },
  {
    name: 'xpRoleRewards',
    entity: XPRoleReward,
    buildFindOptions: guildScoped,
  },
  { name: 'eventConfig', entity: EventConfig, buildFindOptions: guildScoped },
  {
    name: 'eventTemplates',
    entity: EventTemplate,
    buildFindOptions: guildScoped,
  },
  {
    name: 'eventReminders',
    entity: EventReminder,
    buildFindOptions: guildScoped,
  },
  {
    name: 'analyticsConfig',
    entity: AnalyticsConfig,
    buildFindOptions: guildScoped,
  },
  {
    name: 'analyticsSnapshots',
    entity: AnalyticsSnapshot,
    buildFindOptions: guildScoped,
  },
  {
    name: 'onboardingConfig',
    entity: OnboardingConfig,
    buildFindOptions: guildScoped,
  },
  {
    name: 'onboardingCompletions',
    entity: OnboardingCompletion,
    buildFindOptions: guildScoped,
  },
];

async function fetchAllExportData(guildId: string): Promise<Record<string, unknown[]>> {
  const results = await Promise.all(
    EXPORT_ENTITIES.map(async ({ name, entity, buildFindOptions }) => {
      const repo = AppDataSource.getRepository(entity);
      const options = buildFindOptions(guildId);
      const rows = options ? await repo.find(options) : await repo.find();
      return [name, rows] as const;
    }),
  );
  const exportData: Record<string, unknown[]> = Object.fromEntries(results);
  // Derived field: flatten ReactionRoleMenu.options into a top-level list
  // so dashboards/exports can browse them without joining client-side.
  const menus = (exportData.reactionRoleMenus as Array<{ options?: unknown[] }>) ?? [];
  exportData.reactionRoleOptions = menus.flatMap(m => m.options ?? []);
  return exportData;
}

/**
 * Handle data export command
 * Exports all guild data to JSON and sends via DM
 */
export async function dataExportHandler(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
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

    enhancedLogger.info(formatLang(tl.starting, guildId, interaction.user.tag), LogCategory.COMMAND_EXECUTION);

    const exportData = await fetchAllExportData(guildId);

    // Calculate total records
    const totalRecords = Object.values(exportData).reduce((sum, arr) => sum + arr.length, 0);

    // Create export metadata
    const exportMetadata = {
      exportedAt: new Date().toISOString(),
      guildId,
      guildName: interaction.guild?.name || 'Unknown',
      requestedBy: {
        id: interaction.user.id,
        tag: interaction.user.tag,
      },
      totalRecords,
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
      formatLang(tl.completed, totalRecords.toString(), Object.keys(exportData).length.toString()),
      LogCategory.COMMAND_EXECUTION,
    );

    // Send file via DM
    try {
      const dmChannel = await interaction.user.createDM();

      const embed = new EmbedBuilder()
        .setTitle(tl.exportTitle)
        .setDescription(formatLang(tl.exportDescription, interaction.guild?.name || 'Unknown'))
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
        formatLang(tl.dmFailedLog, interaction.user.tag, (dmError as Error).message),
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
}
