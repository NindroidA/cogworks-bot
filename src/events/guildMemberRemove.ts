/**
 * guildMemberRemove — fires on both intentional leaves and kicks/bans.
 *
 * Two distinct jobs:
 *   1. Analytics: count the leave toward the daily snapshot.
 *   2. Bait lifecycle: if a pending bait action (grace period or queued
 *      retry) exists for this user, execute the action immediately via
 *      the REST executor. The bait flow is leave-tolerant — the action
 *      lands on Discord's audit log even though the member partial is
 *      gone. Closes the v3.2.0 audit-finding "user leaves before ban →
 *      orphaned PendingAction row".
 */

import type { GuildMember, PartialGuildMember } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { IdempotencyKey } from '../typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../typeorm/entities/bait/PendingAction';
import { enhancedLogger, LogCategory } from '../utils';
import { activityTracker } from '../utils/analytics/activityTracker';
import { executeBanAction } from '../utils/baitChannel/banExecutor';
import { getRetryQueue } from '../utils/baitChannel/retryQueue';

export default {
  name: 'guildMemberRemove',
  async execute(member: GuildMember | PartialGuildMember): Promise<void> {
    try {
      if (!member.guild) return;
      // Dev guild skipped to match guildMemberAdd / messageCreate — keeps
      // the dev bot's /analytics clean during testing.
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
 * Find any pending bait action(s) for this user and execute them
 * immediately. Pending rows are deleted on success (executor handles
 * idempotency, so no double-execution risk if a tick fires in parallel).
 *
 * Action demotion: a `timeout` row can't execute against a non-member
 * (Discord API requires a live `GuildMember`), so it's demoted to
 * `softban` — the action still has effect (messages purged, user
 * temporarily banned then unbanned). `log-only` stays as-is — we still
 * want the dashboard record.
 */
async function drainPendingBaitActions(member: GuildMember | PartialGuildMember): Promise<void> {
  if (!member.guild) return;

  const pendingRepo = AppDataSource.getRepository(PendingAction);
  const idempotencyRepo = AppDataSource.getRepository(IdempotencyKey);

  // Race avoidance: clear any in-memory grace timers for this user FIRST,
  // so a concurrent setTimeout callback in `baitChannelManager` short-
  // circuits on its `pendingBans.has(key)` guard. Without this, both
  // paths can reach `executeBanAction` — idempotency catches the double
  // execution at Discord level but creates a confusing 'superseded' log
  // row alongside the real action.
  const extClient = member.client as typeof member.client & {
    baitChannelManager?: { cancelGraceForUser(g: string, u: string): void };
  };
  extClient.baitChannelManager?.cancelGraceForUser(member.guild.id, member.id);

  // Let DB failures propagate to the outer try/catch — we'd rather log
  // the error than silently skip the leave-drain. The outer guildMemberRemove
  // handler already wraps everything in try/catch and logs to enhancedLogger.
  const rows = await pendingRepo.find({
    where: { guildId: member.guild.id, userId: member.id },
  });

  if (rows.length === 0) return;

  for (const row of rows) {
    if (row.deadAt) continue; // already dead-lettered; mod can review via dashboard

    // Demote actions that need a live member to softban — the REST ban
    // endpoint works by user ID even after they've left.
    //   - timeout: Discord API requires live GuildMember
    //   - kick: discord.js exposes kick only via `member.kick()`
    //   - log-only: no demotion (just persists the audit row)
    let action = row.action;
    if (action === 'timeout' || action === 'kick') action = 'softban';

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
