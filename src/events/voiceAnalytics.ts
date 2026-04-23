/**
 * Voice-session analytics handler.
 *
 * Tracks per-user voice session duration across every guild, not just those
 * with XP enabled. Runs alongside xpVoiceHandler (which has the same hook
 * but gates on XP config). Sessions live in-memory only: a process restart
 * drops whatever sessions were in flight — acceptable since the XP system
 * already makes that trade-off and a full day of activity isn't at stake.
 *
 * On leave (or channel switch that crosses a null boundary), we compute the
 * elapsed minutes and feed them to the daily analytics counter.
 */

import type { VoiceState } from 'discord.js';
import { enhancedLogger, LogCategory } from '../utils';
import { activityTracker } from '../utils/analytics/activityTracker';

// Key: `${guildId}:${userId}` — matches the shape used elsewhere in this
// file so grep-ability across the codebase stays consistent.
const activeSessions = new Map<string, number>();

/** Stale sessions (bot offline during disconnect) are capped at 24h. */
const MAX_SESSION_MINUTES = 24 * 60;

function sessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export default {
  name: 'voiceAnalytics',

  /** Call from the `voiceStateUpdate` event. */
  execute(oldState: VoiceState, newState: VoiceState): void {
    try {
      const guild = newState.guild || oldState.guild;
      if (!guild) return;
      const userId = newState.member?.id || oldState.member?.id;
      if (!userId) return;

      // Bots (music bots, other community bots) shouldn't pollute activity.
      if (newState.member?.user.bot || oldState.member?.user.bot) return;

      // Dev guild exclusion mirrors the rest of the tracker wiring.
      if (process.env.DEV_GUILD_ID && guild.id === process.env.DEV_GUILD_ID) return;

      const guildId = guild.id;
      const key = sessionKey(guildId, userId);
      const wasInVoice = Boolean(oldState.channelId);
      const isInVoice = Boolean(newState.channelId);

      if (!wasInVoice && isInVoice) {
        activeSessions.set(key, Date.now());
        return;
      }

      if (wasInVoice && !isInVoice) {
        const startedAt = activeSessions.get(key);
        activeSessions.delete(key);
        if (!startedAt) return;
        const minutes = Math.min(Math.floor((Date.now() - startedAt) / 60_000), MAX_SESSION_MINUTES);
        activityTracker.recordVoiceMinutes(guildId, minutes);
      }

      // Channel switches (wasInVoice && isInVoice) are intentionally
      // ignored — the session continues in the new channel and we only
      // care about total voice-minutes for the guild, not per-channel.
    } catch (error) {
      enhancedLogger.error('voiceAnalytics handler failed', error as Error, LogCategory.ERROR);
    }
  },
};
