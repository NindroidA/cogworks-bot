/**
 * guildMemberRemove — fires on both intentional leaves and kicks/bans.
 *
 * Two distinct jobs:
 *   1. Analytics: count the leave toward the daily snapshot.
 *   2. Bait lifecycle: settle the user's pending bait actions in this guild.
 *      Grace periods go to BaitChannelManager.resolveGraceOnLeave, which
 *      re-checks config, test mode, whitelist, the message and the ban list
 *      before acting. Queued retry rows run now via the REST executor, which
 *      is leave-tolerant (bans work by user ID after the member partial is
 *      gone). Closes the v3.2.0 audit-finding "user leaves before ban →
 *      orphaned PendingAction row".
 */

import type { GuildMember, PartialGuildMember } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { IdempotencyKey } from '../typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../typeorm/entities/bait/PendingAction';
import { enhancedLogger, LogCategory } from '../utils';
import { activityTracker } from '../utils/analytics/activityTracker';
import { executeBanAction, fetchBanState } from '../utils/baitChannel/banExecutor';
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
 * runs a grace row itself. Retry rows (attempts >= 1) execute immediately
 * and are deleted on success (executor handles idempotency, so no
 * double-execution risk if a tick fires in parallel).
 *
 * Action demotion: a `timeout` row can't execute against a non-member
 * (Discord API requires a live `GuildMember`), so it's demoted to
 * `softban` — the action still has effect (messages purged, user
 * temporarily banned then unbanned). `log-only` stays as-is — we still
 * want the dashboard record. A softban runs only when the ban list says the
 * user is not banned: the leave may have been a ban by a mod or another bot,
 * and the softban's unban step would lift it. When the ban list can't be read,
 * the row is dropped without acting, as the manager does for grace periods.
 */
async function drainPendingBaitActions(member: GuildMember | PartialGuildMember): Promise<void> {
  if (!member.guild) return;

  const pendingRepo = AppDataSource.getRepository(PendingAction);
  const idempotencyRepo = AppDataSource.getRepository(IdempotencyKey);

  // Grace-period rows (attempts = 0) belong to the manager: it settles them
  // here against the ban list, current config, test mode, whitelist and
  // message state, in this guild only. The loop below only drains retry rows.
  const extClient = member.client as typeof member.client & {
    baitChannelManager?: { resolveGraceOnLeave(g: string, u: string): Promise<void> };
  };
  await extClient.baitChannelManager?.resolveGraceOnLeave(member.guild.id, member.id);

  // Let DB failures propagate to the outer try/catch — we'd rather log
  // the error than silently skip the leave-drain. The outer guildMemberRemove
  // handler already wraps everything in try/catch and logs to enhancedLogger.
  const rows = await pendingRepo.find({
    where: { guildId: member.guild.id, userId: member.id },
  });

  if (rows.length === 0) return;

  let banned: boolean | null | undefined; // looked up once, only if a row would softban

  for (const row of rows) {
    if (row.deadAt) continue; // already dead-lettered; mod can review via dashboard
    if ((row.attempts ?? 0) === 0) continue; // grace row: settled by the manager above, never run blind

    // Demote actions that need a live member to softban — the REST ban
    // endpoint works by user ID even after they've left.
    //   - timeout: Discord API requires live GuildMember
    //   - kick: discord.js exposes kick only via `member.kick()`
    //   - log-only: no demotion (just persists the audit row)
    let action = row.action;
    if (action === 'timeout' || action === 'kick') action = 'softban';

    if (action === 'softban') {
      if (banned === undefined) banned = await fetchBanState(member.guild, member.id);
      // true: the leave was a ban. null: the ban list couldn't be read, and
      // the user may be banned. Either way the softban must not run.
      if (banned !== false) {
        const text = `Skipped pending bait ${row.action} on leave for ${member.id} in ${member.guild.id}`;
        const meta = { guildId: member.guild.id, userId: member.id, originalAction: row.action };
        if (banned) enhancedLogger.info(`${text}: already banned`, LogCategory.SECURITY, meta);
        else enhancedLogger.warn(`${text}: ban list unreadable`, LogCategory.SECURITY, meta);
        await pendingRepo.remove(row);
        continue;
      }
    }

    const result = await executeBanAction(
      {
        guild: member.guild,
        userId: member.id,
        action,
        reason: `cogworks:bait leave-tolerant action=${row.action} score=${row.suspicionScore}`,
        executorId: member.client.user?.id ?? null,
        deleteMessageSeconds: action === 'ban' || action === 'softban' ? 24 * 3600 : undefined,
      },
      idempotencyRepo,
    );

    enhancedLogger.info(
      `Drained pending bait action on leave: ${row.action}→${action} for ${member.id} in ${member.guild.id} (status=${result.status})`,
      LogCategory.SECURITY,
      {
        guildId: member.guild.id,
        userId: member.id,
        originalAction: row.action,
        executedAction: action,
        status: result.status,
      },
    );

    if (result.status === 'queued') {
      // Discord 429 / 5xx / network — the row stays alive so the retry
      // queue can pick it up. The executor does NOT auto-enqueue, so we
      // forward it explicitly (matches the manager's queued-path
      // contract). The enqueue helper upserts on (guildId, userId,
      // messageId), so reusing the existing row is fine.
      const queue = getRetryQueue();
      if (queue) {
        await queue.enqueue({
          guildId: row.guildId,
          userId: row.userId,
          messageId: row.messageId,
          channelId: row.channelId,
          action,
          suspicionScore: row.suspicionScore,
          lastError: result.failureReason,
        });
      } else {
        // No retry queue (boot race) — leave the row in place; the queue's
        // orphan sweep will pick it up next tick.
        enhancedLogger.warn(
          'Retry queue unavailable during leave-drain; row left for orphan sweep',
          LogCategory.SECURITY,
          {
            guildId: row.guildId,
            userId: row.userId,
            messageId: row.messageId,
          },
        );
      }
      continue;
    }

    // executed / duplicate / failed — row served its purpose, remove it.
    // Errors propagate to the outer handler instead of being silently swallowed.
    await pendingRepo.remove(row);
  }
}
