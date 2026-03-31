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
import { invalidateRulesCache } from './rulesReaction';

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

    const results = await Promise.allSettled([
      // BotConfig — globalStaffRole
      (async () => {
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
      })(),

      // RulesConfig — roleId (delete entire record — rules can't function without a role)
      (async () => {
        const repo = AppDataSource.getRepository(RulesConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config || config.roleId !== roleId) return;

        await repo.remove(config);
        invalidateRulesCache(guildId);
        enhancedLogger.info('Deleted RulesConfig for deleted role', LogCategory.SYSTEM, { guildId, roleId });
      })(),

      // ReactionRoleOption — roleId (delete the option, invalidate menu cache)
      (async () => {
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
      })(),

      // AnnouncementConfig — defaultRoleId
      (async () => {
        const repo = AppDataSource.getRepository(AnnouncementConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config) return;

        let changed = false;
        if (config.defaultRoleId === roleId) {
          config.defaultRoleId = null;
          changed = true;
        }
        if (changed) {
          await repo.save(config);
          enhancedLogger.info('Cleared AnnouncementConfig defaultRoleId for deleted role', LogCategory.SYSTEM, {
            guildId,
            roleId,
          });
        }
      })(),

      // StaffRole — role (delete the record)
      (async () => {
        const repo = AppDataSource.getRepository(StaffRole);
        const saved = await repo.find({ where: { guildId, role: roleId } });
        if (saved.length === 0) return;

        await repo.remove(saved);
        enhancedLogger.info(`Deleted ${saved.length} StaffRole(s) for deleted role`, LogCategory.SYSTEM, {
          guildId,
          roleId,
        });
      })(),

      // XPConfig — ignoredRoles[]
      (async () => {
        const repo = AppDataSource.getRepository(XPConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config || !config.ignoredRoles?.includes(roleId)) return;

        config.ignoredRoles = config.ignoredRoles.filter(id => id !== roleId);
        await repo.save(config);
        enhancedLogger.info('Removed deleted role from XPConfig ignoredRoles', LogCategory.SYSTEM, { guildId, roleId });
      })(),

      // XPRoleReward — roleId (delete the reward — can't grant a deleted role)
      (async () => {
        const repo = AppDataSource.getRepository(XPRoleReward);
        const rewards = await repo.find({ where: { guildId, roleId } });
        if (rewards.length === 0) return;

        await repo.remove(rewards);
        enhancedLogger.info(`Deleted ${rewards.length} XPRoleReward(s) for deleted role`, LogCategory.SYSTEM, {
          guildId,
          roleId,
        });
      })(),

      // OnboardingConfig — completionRoleId
      (async () => {
        const repo = AppDataSource.getRepository(OnboardingConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config || config.completionRoleId !== roleId) return;

        config.completionRoleId = null;
        await repo.save(config);
        enhancedLogger.info('Cleared OnboardingConfig completionRoleId for deleted role', LogCategory.SYSTEM, {
          guildId,
          roleId,
        });
      })(),

      // BaitChannelConfig — whitelistedRoles[]
      (async () => {
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
      })(),
    ]);

    // Log any failures
    const entityNames = [
      'BotConfig',
      'RulesConfig',
      'ReactionRoleOption',
      'AnnouncementConfig',
      'StaffRole',
      'XPConfig',
      'XPRoleReward',
      'OnboardingConfig',
      'BaitChannelConfig',
    ];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        enhancedLogger.error(
          `Failed to clean up ${entityNames[i] || 'unknown entity'} for deleted role`,
          result.reason as Error,
          LogCategory.DATABASE,
          { guildId, roleId },
        );
      }
    }
  },
};
