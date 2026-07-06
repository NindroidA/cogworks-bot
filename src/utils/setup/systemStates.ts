/**
 * Detect per-system configuration state from DB.
 *
 * Single source of truth — both the slash-command setup dashboard
 * (`commands/handlers/botSetup/setupDashboard.ts`) and the webapp setup API
 * (`utils/api/handlers/setupHandlers.ts`) call into this so both surfaces
 * report the same status. Adding a new system requires updating ONLY this
 * function plus the `SystemStates` interface.
 */

import { AppDataSource } from '../../typeorm';
import { AnnouncementConfig } from '../../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import { MemoryConfig } from '../../typeorm/entities/memory/MemoryConfig';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';
import { RulesConfig } from '../../typeorm/entities/rules';
import { DEFAULT_SYSTEM_STATES, type SystemStates } from '../../typeorm/entities/SetupState';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { getBaitChannelIds } from '../baitChannel/channelList';

/**
 * Inspect the DB and return per-system status (`not_started` / `partial` /
 * `complete`). On any DB error returns the default (all `not_started`)
 * rather than throwing — callers expect this to never fail.
 */
export async function detectSystemStates(guildId: string): Promise<SystemStates> {
  const states: SystemStates = { ...DEFAULT_SYSTEM_STATES };

  try {
    const [
      botConfig,
      ticketConfig,
      archivedTicket,
      appConfig,
      archivedApp,
      annConfig,
      baitConfig,
      memoryConfig,
      rulesConfig,
      reactionMenuCount,
    ] = await Promise.all([
      AppDataSource.getRepository(BotConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(TicketConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(ApplicationConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(AnnouncementConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(BaitChannelConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(MemoryConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(RulesConfig).findOneBy({ guildId }),
      AppDataSource.getRepository(ReactionRoleMenu).count({ where: { guildId } }),
    ]);

    if (botConfig?.enableGlobalStaffRole && botConfig.globalStaffRole) states.staffRole = 'complete';
    if (ticketConfig && archivedTicket) states.ticket = 'complete';
    else if (ticketConfig) states.ticket = 'partial';
    if (appConfig && archivedApp) states.application = 'complete';
    else if (appConfig) states.application = 'partial';
    if (annConfig?.defaultRoleId && annConfig.defaultChannelId) states.announcement = 'complete';
    if (baitConfig && getBaitChannelIds(baitConfig).length > 0) states.baitchannel = 'complete';
    if (memoryConfig) states.memory = 'complete';
    if (rulesConfig?.channelId && rulesConfig.roleId) states.rules = 'complete';
    if (reactionMenuCount > 0) states.reactionRole = 'complete';
  } catch {
    // DB hiccup — return defaults rather than throwing
  }

  return states;
}
