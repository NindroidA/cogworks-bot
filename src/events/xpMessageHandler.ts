/**
 * XP Message Handler
 *
 * Awards XP on qualifying messages. Handles cooldown, channel/role ignore,
 * multipliers, level-up detection, and role reward assignment.
 */

import type { Message, TextChannel } from 'discord.js';
import { XPUser } from '../typeorm/entities/xp/XPUser';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { lazyRepo } from '../utils/database/lazyRepo';
import { getXPConfig } from '../utils/xp/configCache';
import { handleLevelUp } from '../utils/xp/levelUp';
import { calculateLevel, randomXp } from '../utils/xp/xpCalculator';

const userRepo = lazyRepo(XPUser);

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

      // Check ignored channels. A thread or forum post counts as its parent channel too.
      const parentId = message.channel.isThread() ? message.channel.parentId : null;
      if (config.ignoredChannels?.some(id => id === message.channelId || id === parentId)) return;

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
          // Still on cooldown — bump the message counter with a single-column
          // UPDATE instead of a full-entity save (this is the common path for
          // every message in an XP-enabled guild).
          await userRepo.increment({ guildId, userId: message.author.id }, 'messages', 1);
          return;
        }
      }

      // Calculate XP to award
      let xpAmount = randomXp(config.xpPerMessageMin, config.xpPerMessageMax);

      // Apply channel multiplier
      const channelMultiplier =
        config.multiplierChannels?.[message.channelId] ??
        (parentId ? config.multiplierChannels?.[parentId] : undefined);
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
        const channel = message.channel.isTextBased() ? (message.channel as TextChannel) : null;
        await handleLevelUp(member, config, xpUser.level, channel);
      }
    } catch (error) {
      enhancedLogger.error('XP message handler failed', error as Error, LogCategory.ERROR);
    }
  },
};
