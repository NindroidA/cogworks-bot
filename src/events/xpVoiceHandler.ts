/**
 * XP Voice Handler
 *
 * Awards XP for time in voice, in segments: a segment opens when a member
 * starts earning (in a counted channel, not deafened) and closes, awarding XP
 * at that channel's multiplier, when they stop earning or switch channels.
 * The AFK channel, XP-ignored channels and deafened members don't earn.
 */

import type { GuildMember, VoiceState } from 'discord.js';
import type { XPConfig } from '../typeorm/entities/xp/XPConfig';
import { XPUser } from '../typeorm/entities/xp/XPUser';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { lazyRepo } from '../utils/database/lazyRepo';
import { getXPConfig } from '../utils/xp/configCache';
import { handleLevelUp } from '../utils/xp/levelUp';
import { calculateLevel } from '../utils/xp/xpCalculator';

const userRepo = lazyRepo(XPUser);

/** Whether a voice state earns XP: a counted channel, not deafened, no XP-ignored role. */
export function earnsVoiceXp(state: VoiceState, config: Pick<XPConfig, 'ignoredChannels' | 'ignoredRoles'>): boolean {
  const channelId = state.channelId;
  if (!channelId || channelId === state.guild.afkChannelId) return false;
  if (config.ignoredChannels?.includes(channelId)) return false;
  if (state.deaf) return false; // self- or server-deafened
  return !state.member?.roles.cache.some(r => config.ignoredRoles?.includes(r.id));
}

export default {
  name: 'xpVoice',

  /**
   * Called from voiceStateUpdate event. Opens and closes voice XP segments.
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

      const wasEarning = earnsVoiceXp(oldState, config);
      const isEarning = earnsVoiceXp(newState, config);
      const switched = oldState.channelId !== newState.channelId;

      // Stopped earning (left, deafened, moved to AFK or an ignored channel) or switched channels
      if (wasEarning && (!isEarning || switched)) {
        const member = newState.member ?? oldState.member ?? (await guild.members.fetch(userId).catch(() => null));
        const multiplier = config.multiplierChannels?.[oldState.channelId ?? ''] ?? 1;
        await handleVoiceLeave(guildId, userId, config, multiplier, member);
      }
      // Started earning, or switched into another counted channel
      if (isEarning && (!wasEarning || switched)) {
        await handleVoiceJoin(guildId, userId);
      }
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
 * Award voice XP for the open segment and clear its start timestamp.
 */
async function handleVoiceLeave(
  guildId: string,
  userId: string,
  config: XPConfig,
  multiplier: number,
  member: GuildMember | null,
) {
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
    const xpToAward = Math.floor(cappedMinutes * config.xpPerVoiceMinute * multiplier);

    const oldLevel = xpUser.level;
    xpUser.xp += xpToAward;
    xpUser.voiceMinutes += cappedMinutes;
    xpUser.level = calculateLevel(xpUser.xp);

    await userRepo.save(xpUser);

    // Voice has no message channel: announce only in the level-up channel, and grant role rewards
    if (xpUser.level > oldLevel && member) {
      await handleLevelUp(member, config, xpUser.level, null);
    }
  } catch (error) {
    enhancedLogger.debug(`Failed to award voice XP for ${userId} in guild ${guildId}`, LogCategory.SYSTEM, {
      error: (error as Error).message,
    });
  }
}
