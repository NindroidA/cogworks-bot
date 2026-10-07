/**
 * guildMemberRemove — fires on both intentional leaves and kicks/bans.
 *
 * Two distinct jobs:
 *   1. Analytics: count the leave toward the daily snapshot.
 *   2. Bait lifecycle: settle the user's pending bait actions in this guild.
 *      Grace periods go to BaitChannelManager.resolveGraceOnLeave, which
 *      re-checks config, test mode, whitelist, the message and the ban list
 *      before acting. Queued retry rows run now through the retry queue,
 *      whose REST executor is leave-tolerant (bans work by user ID after the
 *      member partial is gone). Closes the v3.2.0 audit-finding "user leaves
 *      before ban → orphaned PendingAction row".
 */

import type { GuildMember, PartialGuildMember } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { PendingAction } from '../typeorm/entities/bait/PendingAction';
import { enhancedLogger, LogCategory } from '../utils';
import { activityTracker } from '../utils/analytics/activityTracker';
import { getRetryQueue } from '../utils/baitChannel/retryQueue';

export default {
  name: 'guildMemberRemove',
  async execute(member: GuildMember | PartialGuildMember): Promise<void> {
    try {
      if (!member.guild) return;
      // Dev guild skipped to match guildMemberAdd / messageCreate — keeps
      // the dev bot's /analytics clean during testing. This also skips bait
      // settlement on leave there: grace timers just run to expiry.
      if (process.env.DEV_GUILD_ID && member.guild.id === process.env.DEV_GUILD_ID) return;

      activityTracker.recordMemberLeave(member.guild.id);

      // v3.2.0: drain any pending bait actions for this user. The member
      // partial is half-gone, but `guild.bans.create(userId)` works by ID
      // and survives. We run this on the side — analytics doesn't depend
      // on it, so any failure stays scoped.
      await drainPendingBaitActions(member);
    } catch (error) {
      enhancedLogger.error('guildMemberRemove handler failed', error as Error, LogCategory.ERROR);
    }
  },
};

/**
 * Settle this user's pending bait actions in this guild. Grace periods
 * (attempts = 0) are handed to the manager and awaited; this function never
 * runs a grace row itself. Retry rows (attempts >= 1) that existed when the
 * member left run now through the retry queue's runRow: in the member's
 * chain, from a fresh read, under the same rules as a tick (current config;
 * a timeout or kick becomes a softban, which runs only when the ban list
 * says the user is not banned, since its unban would lift a mod's ban).
 */
async function drainPendingBaitActions(member: GuildMember | PartialGuildMember): Promise<void> {
  if (!member.guild) return;

  const pendingRepo = AppDataSource.getRepository(PendingAction);

  // Let DB failures propagate to the outer try/catch — we'd rather log
  // the error than silently skip the leave-drain. The outer guildMemberRemove
  // handler already wraps everything in try/catch and logs to enhancedLogger.
  // Read before the manager settles the leave: a retry it queues meanwhile
  // waits for its backoff instead of running again right away.
  const rows = await pendingRepo.find({
    where: { guildId: member.guild.id, userId: member.id },
  });

  // Grace-period rows (attempts = 0) belong to the manager: it settles them
  // here against the ban list, current config, test mode, whitelist and
  // message state, in this guild only. The loop below only drains retry rows.
  const extClient = member.client as typeof member.client & {
    baitChannelManager?: { resolveGraceOnLeave(g: string, u: string): Promise<void> };
  };
  await extClient.baitChannelManager?.resolveGraceOnLeave(member.guild.id, member.id);

  // No retry queue yet (boot race): the rows stay for its first tick.
  const queue = getRetryQueue();
  for (const row of rows) {
    if (row.deadAt) continue; // already dead-lettered; mod can review via dashboard
    if ((row.attempts ?? 0) === 0) continue; // grace row: settled by the manager above, never run blind
    await queue?.runRow(row);
  }
}
