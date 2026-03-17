import dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { AuditLog } from './entities/AuditLog';
import { AnnouncementConfig } from './entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from './entities/announcement/AnnouncementLog';
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
import { MemoryConfig, MemoryItem, MemoryTag } from './entities/memory';
import { PendingBan } from './entities/PendingBan';
import { ReactionRoleMenu, ReactionRoleOption } from './entities/reactionRole';
import { RulesConfig } from './entities/rules';
import { SavedRole } from './entities/SavedRole';
import { BotStatus } from './entities/status';
import { ArchivedTicket } from './entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from './entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from './entities/ticket/CustomTicketType';
import { Ticket } from './entities/ticket/Ticket';
import { TicketConfig } from './entities/ticket/TicketConfig';
import { UserTicketRestriction } from './entities/ticket/UserTicketRestriction';
import { UserActivity } from './entities/UserActivity';

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
  extra: {
    connectionLimit: 10,
    connectTimeout: 10_000,
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
    AuditLog,
    BaitKeyword,
    JoinEvent,
  ],
});
