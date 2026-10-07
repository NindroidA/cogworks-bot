/**
 * Config cleanup for deleted Discord objects.
 *
 * One table of per-entity cleaners per reference kind (channel, role, message,
 * thread). The delete events call the matching `clean*Refs` function, which
 * runs every cleaner with Promise.allSettled so one failing entity can't stop
 * the others, and logs each failure under that cleaner's name.
 *
 * Each cleaner fetches its repository with AppDataSource.getRepository on every
 * run (no module-scope lazyRepo), so tests can swap the repositories.
 */

import { roleMention } from 'discord.js';
import { type EntityTarget, In } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { AnalyticsConfig } from '../../typeorm/entities/analytics/AnalyticsConfig';
import { AnnouncementConfig } from '../../typeorm/entities/announcement/AnnouncementConfig';
import { Application } from '../../typeorm/entities/application/Application';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import { EventConfig } from '../../typeorm/entities/event/EventConfig';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../typeorm/entities/memory';
import { OnboardingConfig } from '../../typeorm/entities/onboarding/OnboardingConfig';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';
import { ReactionRoleOption } from '../../typeorm/entities/reactionRole/ReactionRoleOption';
import { RulesConfig } from '../../typeorm/entities/rules';
import { StaffRole } from '../../typeorm/entities/StaffRole';
import { StarboardConfig } from '../../typeorm/entities/starboard';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket, type TicketStatusHistoryEntry } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { XPConfig } from '../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../typeorm/entities/xp/XPRoleReward';
import type { ExtendedClient } from '../../types/ExtendedClient';
import { getBaitChannelIds, setBaitChannels } from '../baitChannel/channelList';
import { MAX } from '../constants';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { invalidateGuildMenuCache, invalidateMenuCache } from '../reactionRole/menuCache';
import { invalidateRulesCache } from '../rules/rulesCache';
import { invalidateStarboardCache } from '../starboard/configCache';
import { appendStatusHistory } from '../workflow/workflowHelpers';

// ---------------------------------------------------------------------------
// Channels (channelDelete)
// ---------------------------------------------------------------------------

interface ChannelRefCleaner {
  /** Entity name for failure attribution in error logs. */
  name: string;
  /** Per-entity cleanup. Mutate config and persist on change; the descriptor's
   * name field is used for failure attribution if this throws. */
  clean: (guildId: string, channelId: string, client: ExtendedClient) => Promise<void>;
}

/** The columns closeRowsInDeletedChannel reads and writes on a Ticket or Application. */
interface ChannelRow {
  id: number;
  guildId: string;
  channelId: string | null;
  status: string;
  statusHistory: TicketStatusHistoryEntry[] | null;
}

/** Statuses that are already an outcome: closed, or an application decision that must not be lost. */
const FINAL_STATUSES = new Set(['closed', 'accepted', 'rejected']);

/**
 * Close the tickets/applications whose channel was deleted by hand, so they
 * stop counting as open (workload, SLA alerts, dashboard). The close flows set
 * 'closed' before deleting the channel, so their rows are skipped here.
 */
function closeRowsInDeletedChannel(name: string, entity: EntityTarget<ChannelRow>, maxHistory: number) {
  return async (guildId: string, channelId: string) => {
    const repo = AppDataSource.getRepository(entity);
    const open = (await repo.find({ where: { guildId, channelId } })).filter(row => !FINAL_STATUSES.has(row.status));
    for (const row of open) {
      appendStatusHistory(row, 'closed', 'system', maxHistory, 'channel-deleted');
      // Conditional on the status read above, so a close that lands in between wins
      await repo.update(
        { id: row.id, guildId, status: row.status },
        { status: 'closed', statusHistory: row.statusHistory },
      );
    }
    if (open.length > 0) {
      enhancedLogger.info(`Closed ${open.length} ${name}(s) whose channel was deleted`, LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    }
  };
}

const CHANNEL_REF_CLEANERS: ChannelRefCleaner[] = [
  { name: 'Ticket', clean: closeRowsInDeletedChannel('Ticket', Ticket, MAX.TICKET_STATUS_HISTORY) },
  {
    name: 'Application',
    clean: closeRowsInDeletedChannel('Application', Application, MAX.APPLICATION_STATUS_HISTORY),
  },
  {
    name: 'TicketConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(TicketConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.channelId === channelId) {
        config.channelId = '';
        config.messageId = '';
        changed = true;
      }
      if (config.categoryId === channelId) {
        config.categoryId = null;
        changed = true;
      }
      if (config.slaBreachChannelId === channelId) {
        config.slaBreachChannelId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Nullified TicketConfig references for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'ArchivedTicketConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(ArchivedTicketConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.channelId !== channelId) return;

      config.channelId = '';
      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Nullified ArchivedTicketConfig references for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'ApplicationConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(ApplicationConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.channelId === channelId) {
        config.channelId = '';
        config.messageId = '';
        changed = true;
      }
      if (config.categoryId === channelId) {
        config.categoryId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Nullified ApplicationConfig references for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'ArchivedApplicationConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(ArchivedApplicationConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.channelId !== channelId) return;

      config.channelId = '';
      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Nullified ArchivedApplicationConfig references for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'BaitChannelConfig',
    clean: async (guildId, channelId, client) => {
      const repo = AppDataSource.getRepository(BaitChannelConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      // Union of the effective list and the legacy channelId column: on rows
      // the pre-v3.15.3 dual-write bug left divergent, the legacy column is
      // the admin's most recent explicit choice — deleting the stale
      // channelIds entry must fall back to it, not disable the system.
      const currentChannels = getBaitChannelIds(config);
      const allChannels =
        config.channelId && !currentChannels.includes(config.channelId)
          ? [...currentChannels, config.channelId]
          : currentChannels;
      if (allChannels.includes(channelId)) {
        // The warning banner lives in the legacy-column channel — gone with it
        if (config.channelId === channelId) config.channelMessageId = null;
        const remaining = allChannels.filter(id => id !== channelId);
        setBaitChannels(config, remaining);
        // Only disable when NO bait channels remain — deleting one of several
        // must not silently kill detection on the survivors
        if (remaining.length === 0) config.enabled = false;
        changed = true;
      }
      if (config.logChannelId === channelId) {
        config.logChannelId = null;
        config.logChannelMessageId = null;
        changed = true;
      }
      if (config.summaryChannelId === channelId) {
        config.summaryChannelId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        client.baitChannelManager?.clearConfigCache(guildId);
        enhancedLogger.info('Updated BaitChannelConfig for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'RulesConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(RulesConfig);
      const config = await repo.findOneBy({ guildId, channelId });
      if (!config) return;

      await repo.remove(config);
      invalidateRulesCache(guildId);
      enhancedLogger.info('Deleted RulesConfig for deleted channel', LogCategory.SYSTEM, { guildId, channelId });
    },
  },
  {
    name: 'ReactionRoleMenu',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(ReactionRoleMenu);
      const menus = await repo.find({ where: { guildId, channelId } });
      if (menus.length === 0) return;

      await repo.remove(menus);
      invalidateGuildMenuCache(guildId);
      enhancedLogger.info(`Deleted ${menus.length} ReactionRoleMenu(s) for deleted channel`, LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'MemoryConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(MemoryConfig);
      const configs = await repo.find({ where: { guildId } });
      const match = configs.find(c => c.forumChannelId === channelId);
      if (!match) return;

      // The forum's posts went with it, so its item and tag rows go too (as /memory-setup remove-channel does)
      await AppDataSource.getRepository(MemoryItem).delete({ guildId, memoryConfigId: match.id });
      await AppDataSource.getRepository(MemoryTag).delete({ guildId, memoryConfigId: match.id });
      await repo.remove(match);
      enhancedLogger.info('Deleted MemoryConfig for deleted forum channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'AnnouncementConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(AnnouncementConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.defaultChannelId !== channelId) return;

      config.defaultChannelId = '';
      await repo.save(config);
      enhancedLogger.info('Nullified AnnouncementConfig references for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'StarboardConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(StarboardConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.channelId === channelId) {
        config.enabled = false;
        config.channelId = '';
        changed = true;
      }
      if (config.ignoredChannels?.includes(channelId)) {
        config.ignoredChannels = config.ignoredChannels.filter(id => id !== channelId);
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        invalidateStarboardCache(guildId);
        enhancedLogger.info('Updated StarboardConfig for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'XPConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(XPConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.levelUpChannelId === channelId) {
        config.levelUpChannelId = null;
        changed = true;
      }
      if (config.ignoredChannels?.includes(channelId)) {
        config.ignoredChannels = config.ignoredChannels.filter(id => id !== channelId);
        changed = true;
      }
      if (config.multiplierChannels?.[channelId] !== undefined) {
        const { [channelId]: _, ...rest } = config.multiplierChannels;
        config.multiplierChannels = Object.keys(rest).length > 0 ? rest : null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Updated XPConfig for deleted channel', LogCategory.SYSTEM, { guildId, channelId });
      }
    },
  },
  {
    name: 'EventConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(EventConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.reminderChannelId === channelId) {
        config.reminderChannelId = null;
        changed = true;
      }
      if (config.summaryChannelId === channelId) {
        config.summaryChannelId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Updated EventConfig for deleted channel', LogCategory.SYSTEM, { guildId, channelId });
      }
    },
  },
  {
    name: 'AnalyticsConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(AnalyticsConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.digestChannelId !== channelId) return;

      config.digestChannelId = null;
      await repo.save(config);
      enhancedLogger.info('Nullified AnalyticsConfig digestChannelId for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
];

/** Clear every config reference to one deleted channel. channelDelete calls this. */
export async function cleanChannelRefs(guildId: string, channelId: string, client: ExtendedClient): Promise<void> {
  const results = await Promise.allSettled(CHANNEL_REF_CLEANERS.map(c => c.clean(guildId, channelId, client)));

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      enhancedLogger.error(
        `Failed to clean up ${CHANNEL_REF_CLEANERS[i].name} for deleted channel`,
        r.reason as Error,
        LogCategory.DATABASE,
        { guildId, channelId },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Roles (roleDelete)
// ---------------------------------------------------------------------------

interface RoleRefCleaner {
  /** Entity name for failure attribution. */
  name: string;
  clean: (guildId: string, roleId: string, client: ExtendedClient) => Promise<void>;
}

const ROLE_REF_CLEANERS: RoleRefCleaner[] = [
  {
    name: 'BotConfig',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(BotConfig);
      const config = await repo.findOneBy({ guildId });
      // Raw ID since v3 setup; pre-v3 rows hold `<@&id>`.
      if (!config?.globalStaffRole || ![roleId, roleMention(roleId)].includes(config.globalStaffRole)) return;

      config.globalStaffRole = null;
      config.enableGlobalStaffRole = false;
      await repo.save(config);
      enhancedLogger.info('Cleared BotConfig globalStaffRole for deleted role', LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
  {
    name: 'RulesConfig',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(RulesConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.roleId !== roleId) return;

      await repo.remove(config);
      invalidateRulesCache(guildId);
      enhancedLogger.info('Deleted RulesConfig for deleted role', LogCategory.SYSTEM, { guildId, roleId });
    },
  },
  {
    name: 'ReactionRoleOption',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(ReactionRoleOption);
      const options = await repo
        .createQueryBuilder('opt')
        .innerJoin('opt.menu', 'menu')
        .where('menu.guildId = :guildId', { guildId })
        .andWhere('opt.roleId = :roleId', { roleId })
        .getMany();
      if (options.length === 0) return;

      await repo.remove(options);
      invalidateGuildMenuCache(guildId);
      enhancedLogger.info(`Deleted ${options.length} ReactionRoleOption(s) for deleted role`, LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
  {
    name: 'AnnouncementConfig',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(AnnouncementConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.defaultRoleId !== roleId) return;

      config.defaultRoleId = null;
      await repo.save(config);
      enhancedLogger.info('Cleared AnnouncementConfig defaultRoleId for deleted role', LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
  {
    name: 'StaffRole',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(StaffRole);
      // Raw ID (dashboard, /role add since v3.16.11) or legacy `<@&id>` (older /role add rows).
      const saved = await repo.find({ where: { guildId, role: In([roleId, roleMention(roleId)]) } });
      if (saved.length === 0) return;

      await repo.remove(saved);
      enhancedLogger.info(`Deleted ${saved.length} StaffRole(s) for deleted role`, LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
  {
    name: 'XPConfig',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(XPConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config?.ignoredRoles?.includes(roleId)) return;

      config.ignoredRoles = config.ignoredRoles.filter(id => id !== roleId);
      await repo.save(config);
      enhancedLogger.info('Removed deleted role from XPConfig ignoredRoles', LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
  {
    name: 'XPRoleReward',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(XPRoleReward);
      const rewards = await repo.find({ where: { guildId, roleId } });
      if (rewards.length === 0) return;

      await repo.remove(rewards);
      enhancedLogger.info(`Deleted ${rewards.length} XPRoleReward(s) for deleted role`, LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
  {
    name: 'OnboardingConfig',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(OnboardingConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      const clearCompletion = config.completionRoleId === roleId;
      // Role-select steps would keep offering the deleted role to new members.
      const stepsWithOption = (config.steps ?? []).filter(step => step.options?.some(opt => opt.roleId === roleId));
      if (!clearCompletion && stepsWithOption.length === 0) return;

      if (clearCompletion) config.completionRoleId = null;
      for (const step of stepsWithOption) step.options = step.options?.filter(opt => opt.roleId !== roleId);
      await repo.save(config);
      enhancedLogger.info('Removed deleted role from OnboardingConfig', LogCategory.SYSTEM, {
        guildId,
        roleId,
        completionRoleCleared: clearCompletion,
        stepsUpdated: stepsWithOption.length,
      });
    },
  },
  {
    name: 'BaitChannelConfig',
    clean: async (guildId, roleId, client) => {
      const repo = AppDataSource.getRepository(BaitChannelConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      const inWhitelist = config.whitelistedRoles?.includes(roleId) ?? false;
      const isAlertRole = config.raidModeAlertRoleId === roleId;
      if (!inWhitelist && !isAlertRole) return;

      if (inWhitelist) config.whitelistedRoles = (config.whitelistedRoles ?? []).filter(id => id !== roleId);
      if (isAlertRole) config.raidModeAlertRoleId = null;
      await repo.save(config);
      client.baitChannelManager?.clearConfigCache(guildId);
      enhancedLogger.info('Removed deleted role from BaitChannelConfig', LogCategory.SYSTEM, {
        guildId,
        roleId,
        whitelist: inWhitelist,
        raidModeAlertRole: isAlertRole,
      });
    },
  },
  {
    name: 'TicketConfig',
    clean: async (guildId, roleId) => {
      const repo = AppDataSource.getRepository(TicketConfig);
      const config = await repo.findOneBy({ guildId });
      const rules = config?.routingRules ?? [];
      if (!config || !rules.some(rule => rule.staffRoleId === roleId)) return;

      // Drop the rule (not just its role) so an admin can re-add one for that ticket type.
      config.routingRules = rules.filter(rule => rule.staffRoleId !== roleId);
      await repo.save(config);
      enhancedLogger.info('Removed routing rule(s) for deleted role from TicketConfig', LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
];

/** Clear every config reference to one deleted role. roleDelete calls this. */
export async function cleanRoleRefs(guildId: string, roleId: string, client: ExtendedClient): Promise<void> {
  const results = await Promise.allSettled(ROLE_REF_CLEANERS.map(c => c.clean(guildId, roleId, client)));

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      enhancedLogger.error(
        `Failed to clean up ${ROLE_REF_CLEANERS[i].name} for deleted role`,
        r.reason as Error,
        LogCategory.DATABASE,
        { guildId, roleId },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Messages (messageDelete, messageDeleteBulk)
// ---------------------------------------------------------------------------

interface MessageRefCleaner {
  /** Entity name for failure attribution. */
  name: string;
  /** Per-entity cleanup body. Wrapped in `withTimeout` by the dispatcher. */
  clean: (guildId: string, messageId: string) => Promise<void>;
}

const MESSAGE_REF_CLEANERS: MessageRefCleaner[] = [
  {
    name: 'TicketConfig',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(TicketConfig);
      const config = await repo.findOneBy({ guildId, messageId });
      if (!config) return;

      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Cleared TicketConfig messageId for deleted message', LogCategory.SYSTEM, {
        guildId,
        messageId,
      });
    },
  },
  {
    name: 'ArchivedTicketConfig',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(ArchivedTicketConfig);
      const config = await repo.findOneBy({ guildId, messageId });
      if (!config) return;

      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Cleared ArchivedTicketConfig messageId for deleted message', LogCategory.SYSTEM, {
        guildId,
        messageId,
      });
    },
  },
  {
    name: 'ApplicationConfig',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(ApplicationConfig);
      const config = await repo.findOneBy({ guildId, messageId });
      if (!config) return;

      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Cleared ApplicationConfig messageId for deleted message', LogCategory.SYSTEM, {
        guildId,
        messageId,
      });
    },
  },
  {
    name: 'ArchivedApplicationConfig',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(ArchivedApplicationConfig);
      const config = await repo.findOneBy({ guildId, messageId });
      if (!config) return;

      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Cleared ArchivedApplicationConfig messageId for deleted message', LogCategory.SYSTEM, {
        guildId,
        messageId,
      });
    },
  },
  {
    name: 'BaitChannelConfig',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(BaitChannelConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.channelMessageId === messageId) {
        config.channelMessageId = null;
        changed = true;
      }
      if (config.logChannelMessageId === messageId) {
        config.logChannelMessageId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Cleared BaitChannelConfig message references for deleted message', LogCategory.SYSTEM, {
          guildId,
          messageId,
        });
      }
    },
  },
  {
    name: 'RulesConfig',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(RulesConfig);
      const config = await repo.findOneBy({ guildId, messageId });
      if (!config) return;

      await repo.remove(config);
      invalidateRulesCache(guildId);
      enhancedLogger.info('Deleted RulesConfig for deleted message', LogCategory.SYSTEM, { guildId, messageId });
    },
  },
  {
    name: 'ReactionRoleMenu',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(ReactionRoleMenu);
      const menu = await repo.findOneBy({ guildId, messageId });
      if (!menu) return;

      invalidateMenuCache(messageId);
      await repo.remove(menu);
      enhancedLogger.info('Deleted ReactionRoleMenu for deleted message', LogCategory.SYSTEM, { guildId, messageId });
    },
  },
  {
    name: 'MemoryConfig',
    clean: async (guildId, messageId) => {
      const repo = AppDataSource.getRepository(MemoryConfig);
      const configs = await repo.find({ where: { guildId } });
      const match = configs.find(c => c.messageId === messageId);
      if (!match) return;

      match.messageId = null;
      await repo.save(match);
      enhancedLogger.info('Cleared MemoryConfig messageId for deleted message', LogCategory.SYSTEM, {
        guildId,
        messageId,
      });
    },
  },
];

/** Race a cleanup promise against a 10-second timeout so a slow query can't
 * hold up sibling cleaners. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Config cleanup timed out')), 10_000)),
  ]);
}

/** Clear every config reference to one deleted message. messageDelete and messageDeleteBulk call this. */
export async function cleanMessageRefs(guildId: string, messageId: string): Promise<void> {
  const results = await Promise.allSettled(MESSAGE_REF_CLEANERS.map(c => withTimeout(c.clean(guildId, messageId))));

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      enhancedLogger.error(
        `Failed to clean up ${MESSAGE_REF_CLEANERS[i].name} for deleted message`,
        r.reason as Error,
        LogCategory.DATABASE,
        { guildId, messageId },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Threads (threadDelete)
// ---------------------------------------------------------------------------

interface ThreadRefCleaner {
  /** Entity name for failure attribution. */
  name: string;
  clean: (guildId: string, threadId: string) => Promise<void>;
}

const THREAD_REF_CLEANERS: ThreadRefCleaner[] = [
  {
    // Without its thread the memory item is orphaned, so it goes too.
    name: 'MemoryItem',
    clean: async (guildId, threadId) => {
      const repo = AppDataSource.getRepository(MemoryItem);
      const item = await repo.findOneBy({ guildId, threadId });
      if (!item) return;

      await repo.remove(item);
      enhancedLogger.info('Deleted MemoryItem for deleted thread', LogCategory.SYSTEM, {
        guildId,
        threadId,
        memoryTitle: item.title,
      });
    },
  },
];

/** Clear every config reference to one deleted thread. threadDelete calls this. */
export async function cleanThreadRefs(guildId: string, threadId: string): Promise<void> {
  const results = await Promise.allSettled(THREAD_REF_CLEANERS.map(c => c.clean(guildId, threadId)));

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      enhancedLogger.error(
        `Failed to clean up ${THREAD_REF_CLEANERS[i].name} for deleted thread`,
        r.reason as Error,
        LogCategory.DATABASE,
        { guildId, threadId },
      );
    }
  });
}
