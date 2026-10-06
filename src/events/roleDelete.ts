/**
 * Role Delete Event Handler
 *
 * Cleans up config references when a role is deleted from the guild.
 * Prevents stale role IDs from causing errors when systems try to
 * assign or check roles that no longer exist.
 */

import { type Role, roleMention } from 'discord.js';
import { In } from 'typeorm';
import { AppDataSource } from '../typeorm';
import { AnnouncementConfig } from '../typeorm/entities/announcement/AnnouncementConfig';
import { BotConfig } from '../typeorm/entities/BotConfig';
import { BaitChannelConfig } from '../typeorm/entities/bait/BaitChannelConfig';
import { OnboardingConfig } from '../typeorm/entities/onboarding/OnboardingConfig';
import { ReactionRoleOption } from '../typeorm/entities/reactionRole/ReactionRoleOption';
import { RulesConfig } from '../typeorm/entities/rules';
import { StaffRole } from '../typeorm/entities/StaffRole';
import { TicketConfig } from '../typeorm/entities/ticket/TicketConfig';
import { XPConfig } from '../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../typeorm/entities/xp/XPRoleReward';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { invalidateGuildMenuCache } from '../utils/reactionRole/menuCache';
import { invalidateRulesCache } from '../utils/rules/rulesCache';

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

export default {
  name: 'roleDelete',
  async execute(role: Role, client: ExtendedClient) {
    const guildId = role.guild.id;
    const roleId = role.id;

    enhancedLogger.debug('Role deleted, checking config references', LogCategory.SYSTEM, {
      guildId,
      roleId,
      roleName: role.name,
    });

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
  },
};
