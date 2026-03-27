/**
 * XP Voice Handler
 *
 * Tracks voice channel join/leave events and awards XP based on time spent
 * in voice channels. XP is awarded on disconnect based on session duration.
 */

import type { VoiceState } from 'discord.js';
import { getXPConfig } from '../commands/handlers/xp/setup';
import { XPUser } from '../typeorm/entities/xp/XPUser';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { lazyRepo } from '../utils/database/lazyRepo';
import { calculateLevel } from '../utils/xp/xpCalculator';

const userRepo = lazyRepo(XPUser);

export default {
  name: 'xpVoice',

  /**
   * Called from voiceStateUpdate event. Handles voice join/leave tracking.
   *
   * @param oldState - Previous voice state
   * @param newState - New voice state
   * @param _client - Extended client instance
   */
  async execute(oldState: VoiceState, newState: VoiceState, _client: ExtendedClient) {
    try {
      // Only process guild events
      const guild = newState.guild || oldState.guild;
      if (!guild) return;

      // Ignore bots
      const userId = newState.member?.id || oldState.member?.id;
      if (!userId) return;
      if (newState.member?.user.bot || oldState.member?.user.bot) return;

      const guildId = guild.id;

      // Check if XP and voice XP are enabled (cached)
      const config = await getXPConfig(guildId);
      if (!config?.enabled || !config.voiceXpEnabled) return;

      const wasInVoice = !!oldState.channelId;
      const isInVoice = !!newState.channelId;

      // User joined a voice channel
      if (!wasInVoice && isInVoice) {
        await handleVoiceJoin(guildId, userId);
        return;
      }

      // User left a voice channel
      if (wasInVoice && !isInVoice) {
        await handleVoiceLeave(guildId, userId, config.xpPerVoiceMinute);
        return;
      }

      // User switched channels — no XP change needed, session continues
    } catch (error) {
      enhancedLogger.error('XP voice handler failed', error as Error, LogCategory.ERROR);
    }
  },
};

/**
 * Record voice join time for XP tracking.
 */
async function handleVoiceJoin(guildId: string, userId: string) {
  try {
    let xpUser = await userRepo.findOne({ where: { guildId, userId } });
    if (!xpUser) {
      xpUser = userRepo.create({ guildId, userId });
    }

    xpUser.lastVoiceJoinedAt = new Date();
    await userRepo.save(xpUser);
  } catch (error) {
    enhancedLogger.debug(`Failed to record voice join for ${userId} in guild ${guildId}`, LogCategory.SYSTEM, {
      error: (error as Error).message,
    });
  }
}

/**
 * Award voice XP based on session duration and clear the join timestamp.
 */
async function handleVoiceLeave(guildId: string, userId: string, xpPerVoiceMinute: number) {
  try {
    const xpUser = await userRepo.findOne({ where: { guildId, userId } });
    if (!xpUser?.lastVoiceJoinedAt) return;

    const now = new Date();
    const sessionMs = now.getTime() - xpUser.lastVoiceJoinedAt.getTime();
    const sessionMinutes = Math.floor(sessionMs / 60_000);

    // Clear the voice join timestamp
    xpUser.lastVoiceJoinedAt = null;

    // Award XP only for sessions of at least 1 minute
    if (sessionMinutes < 1) {
      await userRepo.save(xpUser);
      return;
    }

    // Cap at 24 hours (1440 minutes) to prevent abuse from stale sessions
    const cappedMinutes = Math.min(sessionMinutes, 1440);
    const xpToAward = cappedMinutes * xpPerVoiceMinute;

    const oldLevel = xpUser.level;
    xpUser.xp += xpToAward;
    xpUser.voiceMinutes += cappedMinutes;
    xpUser.level = calculateLevel(xpUser.xp);

    await userRepo.save(xpUser);

    if (xpUser.level > oldLevel) {
      enhancedLogger.debug(
        `User ${userId} leveled up to ${xpUser.level} via voice XP in guild ${guildId}`,
        LogCategory.SYSTEM,
      );
      // Note: Voice level-up announcements could be added here in the future.
      // Currently, level-up messages are only sent for message-based XP gains
      // because voice disconnects don't have a natural message channel context.
    }
  } catch (error) {
    enhancedLogger.debug(`Failed to award voice XP for ${userId} in guild ${guildId}`, LogCategory.SYSTEM, {
      error: (error as Error).message,
    });
  }
}
