/**
 * XP Message Handler
 *
 * Awards XP on qualifying messages. Handles cooldown, channel/role ignore,
 * multipliers, level-up detection, and role reward assignment.
 */

import type { GuildMember, Message, TextChannel } from 'discord.js';
import { getXPConfig } from '../commands/handlers/xp/setup';
import { XPRoleReward } from '../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../typeorm/entities/xp/XPUser';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { lazyRepo } from '../utils/database/lazyRepo';
import { calculateLevel, randomXp } from '../utils/xp/xpCalculator';

const userRepo = lazyRepo(XPUser);
const rewardRepo = lazyRepo(XPRoleReward);

export default {
  name: 'xpMessage',

  /**
   * Called from messageCreate event. Separate export so the main messageCreate
   * handler can invoke this without tight coupling.
   */
  async execute(message: Message, _client: ExtendedClient) {
    try {
      if (!message.guild) return;
      if (message.author.bot) return;

      const guildId = message.guild.id;

      // Fast-path: check if XP is enabled (cached)
      const config = await getXPConfig(guildId);
      if (!config?.enabled) return;

      // Check ignored channels
      if (config.ignoredChannels?.includes(message.channelId)) return;

      // Check ignored roles
      const member = message.member;
      if (!member) return;
      if (config.ignoredRoles?.length) {
        const hasIgnoredRole = member.roles.cache.some(r => config.ignoredRoles!.includes(r.id));
        if (hasIgnoredRole) return;
      }

      // Get or create XP user record
      let xpUser = await userRepo.findOne({
        where: { guildId, userId: message.author.id },
      });

      if (!xpUser) {
        xpUser = userRepo.create({
          guildId,
          userId: message.author.id,
        });
      }

      // Always increment message count
      xpUser.messages += 1;

      // Check cooldown
      const now = new Date();
      if (xpUser.lastXpAt) {
        const cooldownMs = config.xpCooldownSeconds * 1000;
        const elapsed = now.getTime() - xpUser.lastXpAt.getTime();
        if (elapsed < cooldownMs) {
          // Still on cooldown — save message count but no XP
          await userRepo.save(xpUser);
          return;
        }
      }

      // Calculate XP to award
      let xpAmount = randomXp(config.xpPerMessageMin, config.xpPerMessageMax);

      // Apply channel multiplier
      const channelMultiplier = config.multiplierChannels?.[message.channelId];
      if (channelMultiplier) {
        xpAmount = Math.floor(xpAmount * channelMultiplier);
      }

      // Ensure at least 1 XP
      xpAmount = Math.max(1, xpAmount);

      const oldLevel = xpUser.level;
      xpUser.xp += xpAmount;
      xpUser.level = calculateLevel(xpUser.xp);
      xpUser.lastXpAt = now;

      await userRepo.save(xpUser);

      // Check for level-up
      if (xpUser.level > oldLevel) {
        await handleLevelUp(message, config, xpUser, member);
      }
    } catch (error) {
      enhancedLogger.error('XP message handler failed', error as Error, LogCategory.ERROR);
    }
  },
};

/**
 * Handle a level-up event: send announcement and check role rewards.
 */
async function handleLevelUp(
  message: Message,
  config: {
    levelUpChannelId: string | null;
    levelUpMessage: string;
    guildId: string;
  },
  xpUser: XPUser,
  member: GuildMember,
) {
  try {
    // Send level-up announcement
    const announcement = config.levelUpMessage
      .replace('{user}', `<@${xpUser.userId}>`)
      .replace('{level}', String(xpUser.level));

    let targetChannel: TextChannel | null = null;
    if (config.levelUpChannelId) {
      const ch = message.guild?.channels.cache.get(config.levelUpChannelId);
      if (ch?.isTextBased()) {
        targetChannel = ch as TextChannel;
      }
    } else {
      // Send in same channel
      if (message.channel.isTextBased()) {
        targetChannel = message.channel as TextChannel;
      }
    }

    if (targetChannel) {
      await targetChannel.send(announcement);
    }

    // Check role rewards
    const rewards = await rewardRepo.find({
      where: { guildId: config.guildId },
      order: { level: 'ASC' },
    });

    for (const reward of rewards) {
      if (xpUser.level >= reward.level) {
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
    enhancedLogger.debug(
      `Error handling level-up for ${xpUser.userId} in guild ${config.guildId}`,
      LogCategory.SYSTEM,
      {
        error: (error as Error).message,
      },
    );
  }
}
