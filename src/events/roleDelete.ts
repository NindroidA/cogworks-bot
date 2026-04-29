/**
 * Role Delete Event Handler
 *
 * Cleans up config references when a role is deleted from the guild.
 * Prevents stale role IDs from causing errors when systems try to
 * assign or check roles that no longer exist.
 */

import type { Role } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { AnnouncementConfig } from '../typeorm/entities/announcement/AnnouncementConfig';
import { BotConfig } from '../typeorm/entities/BotConfig';
import { BaitChannelConfig } from '../typeorm/entities/bait/BaitChannelConfig';
import { OnboardingConfig } from '../typeorm/entities/onboarding/OnboardingConfig';
import { ReactionRoleOption } from '../typeorm/entities/reactionRole/ReactionRoleOption';
import { RulesConfig } from '../typeorm/entities/rules';
import { StaffRole } from '../typeorm/entities/StaffRole';
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
      if (!config || config.globalStaffRole !== roleId) return;

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
      const saved = await repo.find({ where: { guildId, role: roleId } });
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
      if (!config || !config.ignoredRoles?.includes(roleId)) return;

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
      if (!config || config.completionRoleId !== roleId) return;

      config.completionRoleId = null;
      await repo.save(config);
      enhancedLogger.info('Cleared OnboardingConfig completionRoleId for deleted role', LogCategory.SYSTEM, {
        guildId,
        roleId,
      });
    },
  },
  {
    name: 'BaitChannelConfig',
    clean: async (guildId, roleId, client) => {
      const repo = AppDataSource.getRepository(BaitChannelConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || !config.whitelistedRoles?.includes(roleId)) return;

      config.whitelistedRoles = config.whitelistedRoles.filter(id => id !== roleId);
      await repo.save(config);
      client.baitChannelManager?.clearConfigCache(guildId);
      enhancedLogger.info('Removed deleted role from BaitChannelConfig whitelistedRoles', LogCategory.SYSTEM, {
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
