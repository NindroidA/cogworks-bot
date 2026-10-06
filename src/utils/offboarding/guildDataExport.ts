/**
 * Guild data export: the single list of guild-scoped entities that
 * /data-export serializes, kept out of the handler so other exports can reuse it.
 *
 * Keep this in step with `deleteAllGuildData` (guildQueries.ts): anything the
 * purge deletes should be exportable first. A unit test diffs both lists
 * against the DataSource entity list.
 */

import { type EntityTarget, type FindManyOptions, MoreThanOrEqual, type ObjectLiteral } from 'typeorm';
import { AppDataSource } from '../../typeorm';

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
import { IdempotencyKey } from '../../typeorm/entities/bait/IdempotencyKey';
import { JoinEvent } from '../../typeorm/entities/bait/JoinEvent';
import { PendingAction } from '../../typeorm/entities/bait/PendingAction';
import { EventConfig } from '../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../../typeorm/entities/event/EventTemplate';
import { GuildPermission } from '../../typeorm/entities/GuildPermission';
import { ImportLog } from '../../typeorm/entities/import/ImportLog';
import { MemoryConfig } from '../../typeorm/entities/memory/MemoryConfig';
import { MemoryItem } from '../../typeorm/entities/memory/MemoryItem';
import { MemoryTag } from '../../typeorm/entities/memory/MemoryTag';
import { OnboardingCompletion } from '../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../typeorm/entities/onboarding/OnboardingConfig';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { RulesConfig } from '../../typeorm/entities/rules/RulesConfig';
import { SetupState } from '../../typeorm/entities/SetupState';
import { StaffRole } from '../../typeorm/entities/StaffRole';
import { StarboardConfig } from '../../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../../typeorm/entities/starboard/StarboardEntry';
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
import { RETENTION_DAYS } from '../constants';

export interface ExportEntity {
  /** Output key in the exported JSON's `data` object. */
  name: string;
  entity: EntityTarget<ObjectLiteral>;
  /** Builds the guild-scoped TypeORM FindManyOptions for this entity. */
  buildFindOptions: (guildId: string) => FindManyOptions<ObjectLiteral>;
}

const guildScoped = (guildId: string): FindManyOptions<ObjectLiteral> => ({
  where: { guildId },
});

export const EXPORT_ENTITIES: ExportEntity[] = [
  { name: 'botConfig', entity: BotConfig, buildFindOptions: guildScoped },
  { name: 'guildPermissions', entity: GuildPermission, buildFindOptions: guildScoped },
  { name: 'setupState', entity: SetupState, buildFindOptions: guildScoped },
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
      relations: { options: true },
    }),
  },
  {
    name: 'pendingActions',
    entity: PendingAction,
    buildFindOptions: guildScoped,
  },
  {
    name: 'idempotencyKeys',
    entity: IdempotencyKey,
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
  { name: 'userActivity', entity: UserActivity, buildFindOptions: guildScoped },
  { name: 'auditLogs', entity: AuditLog, buildFindOptions: guildScoped },
  { name: 'baitKeywords', entity: BaitKeyword, buildFindOptions: guildScoped },
  { name: 'importLogs', entity: ImportLog, buildFindOptions: guildScoped },
  {
    // Export window matches the JoinEvent retention sweep (RETENTION_DAYS.JOIN_EVENT)
    // — older rows are already purged, so a wider window would only mislead.
    name: 'joinEvents',
    entity: JoinEvent,
    buildFindOptions: guildId => ({
      where: {
        guildId,
        joinedAt: MoreThanOrEqual(new Date(Date.now() - RETENTION_DAYS.JOIN_EVENT * 24 * 60 * 60 * 1000)),
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

/** Every guild-scoped row Cogworks stores for `guildId`, keyed by export name. */
export async function fetchAllExportData(guildId: string): Promise<Record<string, unknown[]>> {
  const results = await Promise.all(
    EXPORT_ENTITIES.map(async ({ name, entity, buildFindOptions }) => {
      const rows = await AppDataSource.getRepository(entity).find(buildFindOptions(guildId));
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
 * Largest file Cogworks will try to DM or attach. Discord's default bot upload
 * cap is 10 MiB; staying under 8 MiB leaves room for the message body.
 */
export const MAX_EXPORT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
