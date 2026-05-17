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

export default {
  name: 'guildMemberRemove',
  async execute(member: GuildMember | PartialGuildMember): Promise<void> {
    try {
      if (!member.guild) return;
      // Dev guild skipped to match guildMemberAdd / messageCreate — keeps
      // the dev bot's /insights clean during testing.
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

  const rows = await pendingRepo
    .find({ where: { guildId: member.guild.id, userId: member.id } })
    .catch(() => [] as PendingAction[]);

  if (rows.length === 0) return;

  for (const row of rows) {
    if (row.deadAt) continue; // already dead-lettered; mod can review via dashboard

    // Demote timeout to softban — timeout requires a live member.
    let action = row.action;
    if (action === 'timeout') action = 'softban';

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

    // Remove the row regardless of executor outcome:
    //   - executed/duplicate: row served its purpose
    //   - queued: the executor already enqueued via the retry queue's
    //     own row mechanics (and Phase 3's `enqueue` handles upsert)
    //   - failed: terminal Discord error (user already banned, etc.);
    //     nothing more to retry on a non-member
    await pendingRepo.remove(row).catch(() => {});
  }
}
