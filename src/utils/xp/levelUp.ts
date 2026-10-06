/**
 * Level-up side effects shared by message and voice XP: the announcement and
 * the role rewards.
 */

import type { GuildMember, TextChannel } from 'discord.js';
import { XPRoleReward } from '../../typeorm/entities/xp/XPRoleReward';
import { lazyRepo } from '../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

const rewardRepo = lazyRepo(XPRoleReward);

export interface LevelUpConfig {
  guildId: string;
  levelUpChannelId: string | null;
  levelUpMessage: string;
}

/**
 * Announce a level-up and sync role rewards. The announcement goes to the
 * level-up channel when one is set, else to `fallbackChannel` (the message's
 * channel; voice XP has none). It pings only the member: the template is free
 * text a delegated XP manager sets, and the bot may have Mention Everyone.
 */
export async function handleLevelUp(
  member: GuildMember,
  config: LevelUpConfig,
  level: number,
  fallbackChannel: TextChannel | null,
): Promise<void> {
  try {
    const announcement = config.levelUpMessage.replace('{user}', `<@${member.id}>`).replace('{level}', String(level));

    let targetChannel = fallbackChannel;
    if (config.levelUpChannelId) {
      const ch = member.guild.channels.cache.get(config.levelUpChannelId);
      targetChannel = ch?.isTextBased() ? (ch as TextChannel) : null;
    }

    if (targetChannel) {
      await targetChannel.send({ content: announcement, allowedMentions: { users: [member.id] } });
    }

    // Check role rewards
    const rewards = await rewardRepo.find({
      where: { guildId: config.guildId },
      order: { level: 'ASC' },
    });

    for (const reward of rewards) {
      if (level >= reward.level) {
        // Grant role if they don't have it
        if (!member.roles.cache.has(reward.roleId)) {
          try {
            await member.roles.add(reward.roleId, `XP Level ${reward.level} reward`);
            enhancedLogger.info(
              `Granted role ${reward.roleId} to ${member.id} for reaching level ${reward.level} in guild ${config.guildId}`,
              LogCategory.SYSTEM,
            );
          } catch (error) {
            enhancedLogger.debug(`Failed to grant role reward ${reward.roleId} to ${member.id}`, LogCategory.SYSTEM, {
              error: (error as Error).message,
            });
          }
        }
      } else if (reward.removeOnDelevel && member.roles.cache.has(reward.roleId)) {
        // Remove role if below level and removeOnDelevel is set
        try {
          await member.roles.remove(reward.roleId, `Below XP Level ${reward.level}`);
        } catch (error) {
          enhancedLogger.debug(`Failed to remove role reward ${reward.roleId} from ${member.id}`, LogCategory.SYSTEM, {
            error: (error as Error).message,
          });
        }
      }
    }
  } catch (error) {
    enhancedLogger.debug(`Error handling level-up for ${member.id} in guild ${config.guildId}`, LogCategory.SYSTEM, {
      error: (error as Error).message,
    });
  }
}
