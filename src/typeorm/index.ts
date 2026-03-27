import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { AuditLog } from './entities/AuditLog';
import { AnalyticsConfig } from './entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from './entities/analytics/AnalyticsSnapshot';
import { AnnouncementConfig } from './entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from './entities/announcement/AnnouncementLog';
import { AnnouncementTemplate } from './entities/announcement/AnnouncementTemplate';
import { Application } from './entities/application/Application';
import { ApplicationConfig } from './entities/application/ApplicationConfig';
import { ArchivedApplication } from './entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from './entities/application/ArchivedApplicationConfig';
import { Position } from './entities/application/Position';
import { BaitChannelConfig } from './entities/BaitChannelConfig';
import { BaitChannelLog } from './entities/BaitChannelLog';
import { BotConfig } from './entities/BotConfig';
import { BaitKeyword } from './entities/bait/BaitKeyword';
import { JoinEvent } from './entities/bait/JoinEvent';
import { EventConfig } from './entities/event/EventConfig';
import { EventReminder } from './entities/event/EventReminder';
import { EventTemplate } from './entities/event/EventTemplate';
import { ImportLog } from './entities/import/ImportLog';
import { MemoryConfig, MemoryItem, MemoryTag } from './entities/memory';
import { OnboardingCompletion } from './entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from './entities/onboarding/OnboardingConfig';
import { PendingBan } from './entities/PendingBan';
import { ReactionRoleMenu, ReactionRoleOption } from './entities/reactionRole';
import { RulesConfig } from './entities/rules';
import { SavedRole } from './entities/SavedRole';
import { SetupState } from './entities/SetupState';
import { StarboardConfig, StarboardEntry } from './entities/starboard';
import { BotStatus, StatusIncident } from './entities/status';
import { ArchivedTicket } from './entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from './entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from './entities/ticket/CustomTicketType';
import { Ticket } from './entities/ticket/Ticket';
import { TicketConfig } from './entities/ticket/TicketConfig';
import { UserTicketRestriction } from './entities/ticket/UserTicketRestriction';
import { UserActivity } from './entities/UserActivity';
import { XPConfig } from './entities/xp/XPConfig';
import { XPRoleReward } from './entities/xp/XPRoleReward';
import { XPUser } from './entities/xp/XPUser';

dotenv.config();

const IS_DEV = (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.MYSQL_DB_HOST,
  port: parseInt(process.env.MYSQL_DB_PORT!, 10),
  username: process.env.MYSQL_DB_USERNAME,
  password: process.env.MYSQL_DB_PASSWORD,
  database: process.env.MYSQL_DB_DATABASE,
  synchronize: IS_DEV,
  migrationsRun: !IS_DEV,
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  maxQueryExecutionTime: 5000,
  extra: {
    connectionLimit: 20,
    connectTimeout: 10_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30_000,
  },
  entities: [
    TicketConfig,
    Ticket,
    ArchivedTicketConfig,
    ArchivedTicket,
    CustomTicketType,
    UserTicketRestriction,
    SavedRole,
    BotConfig,
    Application,
    ApplicationConfig,
    ArchivedApplication,
    ArchivedApplicationConfig,
    Position,
    AnnouncementConfig,
    AnnouncementLog,
    AnnouncementTemplate,
    BaitChannelConfig,
    BaitChannelLog,
    PendingBan,
    UserActivity,
    MemoryConfig,
    MemoryTag,
    MemoryItem,
    RulesConfig,
    ReactionRoleMenu,
    ReactionRoleOption,
    BotStatus,
    StatusIncident,
    AuditLog,
    BaitKeyword,
    ImportLog,
    JoinEvent,
    StarboardConfig,
    StarboardEntry,
    XPConfig,
    XPUser,
    XPRoleReward,
    OnboardingConfig,
    OnboardingCompletion,
    EventConfig,
    EventTemplate,
    EventReminder,
    AnalyticsConfig,
    AnalyticsSnapshot,
    SetupState,
  ],
});
