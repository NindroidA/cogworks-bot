/**
 * `GuildAuditLogEntryCreate` event listener for bait moderation attribution.
 *
 * Fires when Discord writes an audit-log entry — in real time, no polling.
 * Used to:
 *
 * 1. **Attribute bot-self actions.** When the bot itself just executed a
 *    ban/kick/timeout via `banExecutor`, the matching audit entry's
 *    `executorId` will be our `client.user.id`. We find the recent
 *    BaitChannelLog row for `(guildId, userId)` and patch in
 *    `discordAuditLogId` + `actionConfirmedAt`. This closes the
 *    correlation gap: previously, an admin reading the bait log could
 *    see "we banned user X with suspicion=87" but had no link back to
 *    the actual Discord audit log entry.
 *
 * 2. **Detect mod-supersedes-us.** When a mod (or another bot) bans the
 *    same user a bait detection is pending on, the audit entry's
 *    `executorId !== client.user.id`. We:
 *    - Delete any matching `pending_actions` rows (so the retry queue
 *      doesn't try to re-execute over the mod's action).
 *    - Write an `idempotency_keys` row (so any in-flight
 *      `executeBanAction` call sees the dup and short-circuits).
 *    - Write a `BaitChannelLog` row with `actionTaken='superseded-by-mod'`
 *      and `executorId=mod.id` so the dashboard surfaces what happened.
 *
 * 3. **Track unbans.** `MEMBER_BAN_REMOVE` updates the most-recent
 *    BaitChannelLog ban row for the user with `unbannedAt` + `unbannedBy`.
 *    Useful for false-positive analytics (an admin overriding a bait ban
 *    is a signal that the bait config may be too aggressive).
 *
 * Required intent: `GuildModeration` (set in `src/index.ts` client config).
 */

import { AuditLogEvent, type Client, Events, type GuildAuditLogsEntry } from 'discord.js';
import { IsNull, MoreThanOrEqual } from 'typeorm';
import { AppDataSource } from '../typeorm';
import { BaitChannelLog } from '../typeorm/entities/bait/BaitChannelLog';
import { IdempotencyKey } from '../typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../typeorm/entities/bait/PendingAction';
import { IDEMPOTENCY_TTL_MS } from '../utils/baitChannel/banExecutor';
import { ErrorCategory, ErrorSeverity, logError } from '../utils/errorHandler';
import { enhancedLogger, LogCategory } from '../utils/monitoring/enhancedLogger';

/**
 * Window for matching an audit entry to one of our recent BaitChannelLog
 * rows. The entry fires nearly synchronously with the action so a 5-minute
 * lookback catches retries + clock skew. The query is indexed on
 * `(guildId, createdAt)` so the scan is cheap.
 */
const RECENT_LOG_WINDOW_MS = 5 * 60 * 1000;

/**
 * Idempotency key TTL for mod-superseded rows. Matches the executor's
 * 24h TTL so duplicate detection windows align.
 */

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Map a Discord audit event to a bait action name. Returns null for events
 * we don't care about so the handler can early-exit.
 */
function auditEventToAction(event: AuditLogEvent): 'ban' | 'kick' | 'timeout' | 'unban' | null {
  switch (event) {
    case AuditLogEvent.MemberBanAdd:
      return 'ban';
    case AuditLogEvent.MemberKick:
      return 'kick';
    case AuditLogEvent.MemberBanRemove:
      return 'unban';
    case AuditLogEvent.MemberUpdate:
      // MemberUpdate fires for many things; we only care about timeout-set.
      // Caller filters on the change list before invoking us.
      return 'timeout';
    default:
      return null;
  }
}

/**
 * Detect whether a MemberUpdate audit entry represents a timeout-set
 * (Discord stores the timeout as `communication_disabled_until` on the
 * member). Timeout-clear is a separate audit shape we don't track here.
 */
function isTimeoutSet(entry: GuildAuditLogsEntry): boolean {
  if (entry.action !== AuditLogEvent.MemberUpdate) return false;
  return entry.changes.some(c => c.key === 'communication_disabled_until' && c.new != null);
}

export function registerAuditLogEntryCreateHandler(client: Client): void {
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    try {
      // Filter to bait-relevant events. MemberUpdate is noisy — only handle
      // the timeout-set sub-case.
      if (entry.action === AuditLogEvent.MemberUpdate && !isTimeoutSet(entry)) return;
      const action = auditEventToAction(entry.action);
      if (!action) return;

      // `targetId` is the affected user. `executorId` is who did it.
      // Discord types both as nullable — bail if missing.
      const targetId = entry.targetId;
      const executorId = entry.executorId;
      if (!targetId || !executorId) return;

      const isSelf = executorId === client.user?.id;

      if (action === 'unban') {
        await handleUnban(guild.id, targetId, executorId, entry.id);
        return;
      }

      if (isSelf) {
        await confirmSelfAction(guild.id, targetId, entry.id);
      } else {
        await handleModSupersedes(guild.id, targetId, executorId, action, entry.id);
      }
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
        message: 'auditLogEntryCreate handler failed',
        error,
        context: {
          guildId: guild.id,
          action: entry.action,
          targetId: entry.targetId,
        },
      });
    }
  });

  enhancedLogger.info('auditLogEntryCreate listener registered', LogCategory.SYSTEM);
}

/**
 * Bot-self path: find the most-recent BaitChannelLog row for this
 * `(guildId, userId)` within the lookback window and patch in audit
 * correlation fields. No row to update is fine — could be a manual
 * `guild.bans.create()` outside the bait path.
 */
async function confirmSelfAction(guildId: string, userId: string, auditLogId: string): Promise<void> {
  const repo = AppDataSource.getRepository(BaitChannelLog);
  const since = new Date(Date.now() - RECENT_LOG_WINDOW_MS);

  const log = await repo.findOne({
    where: {
      guildId,
      userId,
      createdAt: MoreThanOrEqual(since),
    },
    order: { createdAt: 'DESC' },
  });

  if (!log) return; // no matching bait log within window — bot action was non-bait
  if (log.actionConfirmedAt) return; // already confirmed (idempotent)

  log.discordAuditLogId = auditLogId;
  log.actionConfirmedAt = new Date();
  await repo.save(log);

  enhancedLogger.debug(`Bait log ${log.id} confirmed via audit entry ${auditLogId}`, LogCategory.SECURITY, {
    guildId,
    userId,
    auditLogId,
  });
}

/**
 * Mod-supersedes-us path: a non-bot executor performed the action. Cancel
 * any pending bait action against this user (the mod has already handled
 * it) and write the idempotency key so any in-flight retry sees the dup.
 */
async function handleModSupersedes(
  guildId: string,
  userId: string,
  executorId: string,
  action: 'ban' | 'kick' | 'timeout',
  auditLogId: string,
): Promise<void> {
  const pendingRepo = AppDataSource.getRepository(PendingAction);
  const idempotencyRepo = AppDataSource.getRepository(IdempotencyKey);
  const logRepo = AppDataSource.getRepository(BaitChannelLog);

  // Step 1: claim the idempotency key with the mod's executor ID. This
  // prevents the retry queue / in-flight executor calls from re-executing.
  // If the key already exists (bot already did this), skip to step 2 to
  // verify but don't overwrite executor attribution.
  const claim = idempotencyRepo.create({
    guildId,
    userId,
    action,
    dayBucket: todayUtc(),
    executorId,
    testMode: false,
    expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
  });
  try {
    await idempotencyRepo.save(claim);
  } catch {
    // Duplicate-key — bot already executed. Don't overwrite.
  }

  // Step 2: delete any pending actions targeting this user. The retry
  // queue would otherwise try to re-execute on the now-banned user (which
  // would 10026 "Unknown Ban" and dead-letter).
  const cancelled = await pendingRepo.delete({ guildId, userId });

  // Step 3: log the superseded event. Three cases:
  //   (a) Existing log row in 'queued' / 'failed' / 'logged' state →
  //       update it in place to 'superseded-by-mod'.
  //   (b) Existing log row already actioned (e.g., we executed before
  //       the mod's action wins the audit race) → leave it alone.
  //   (c) No recent log row (typical grace-period scenario where we
  //       haven't yet written the BaitChannelLog) → insert a new row
  //       so the dashboard can see the mod-supersedes event. Better to
  //       record minimal metadata than silently drop attribution.
  const since = new Date(Date.now() - RECENT_LOG_WINDOW_MS);
  const existingLog = await logRepo.findOne({
    where: {
      guildId,
      userId,
      createdAt: MoreThanOrEqual(since),
    },
    order: { createdAt: 'DESC' },
  });

  const UPDATABLE_ACTION_STATES = new Set(['queued', 'failed', 'logged']);
  if (existingLog && UPDATABLE_ACTION_STATES.has(existingLog.actionTaken)) {
    // (a) update in place
    existingLog.actionTaken = 'superseded-by-mod';
    existingLog.executorId = executorId;
    existingLog.discordAuditLogId = auditLogId;
    existingLog.actionConfirmedAt = new Date();
    await logRepo.save(existingLog);
  } else if (!existingLog) {
    // (c) no row yet — insert a minimal-metadata row so this event isn't
    // lost. Score/flags/content are unknown (the bot never got to write
    // the row), but guildId+userId+executor+action+auditLog ID is enough
    // for the dashboard to correlate.
    await logRepo.save(
      logRepo.create({
        guildId,
        userId,
        username: 'unknown', // we don't have a member ref here
        channelId: '0',
        messageContent: '',
        messageId: '0',
        actionTaken: 'superseded-by-mod',
        accountAgeDays: 0,
        membershipMinutes: 0,
        executorId,
        discordAuditLogId: auditLogId,
        actionConfirmedAt: new Date(),
      }),
    );
  }
  // case (b): already-executed row left as-is — duplicate attribution from
  // a slightly delayed mod action would overwrite our own audit-confirmed
  // log, which is incorrect.

  enhancedLogger.info(
    `Mod ${executorId} superseded bait ${action} against ${userId} in ${guildId} (cancelled ${cancelled.affected ?? 0} pending row(s))`,
    LogCategory.SECURITY,
    {
      guildId,
      userId,
      executorId,
      action,
      auditLogId,
      pendingCancelled: cancelled.affected ?? 0,
    },
  );
}

/**
 * Unban: find the most-recent BaitChannelLog ban row for this user (within
 * a longer window — bans can sit for weeks before being reversed) and
 * record unban attribution. Used by the dashboard for false-positive
 * analytics ("X% of bait bans get reversed within Y days").
 */
async function handleUnban(guildId: string, userId: string, executorId: string, _auditLogId: string): Promise<void> {
  const repo = AppDataSource.getRepository(BaitChannelLog);

  // Bait bans can persist; widen the lookback to 365 days. The bot's own
  // softban reverses are filtered out (bot-self executor); a mod reversing
  // a bot ban is what we care about.
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  // `unbannedAt: undefined` is a no-op in TypeORM's where — we want
  // `IS NULL` so already-unbanned rows aren't re-stamped if the same user
  // is banned + unbanned a second time.
  const log = await repo.findOne({
    where: {
      guildId,
      userId,
      actionTaken: 'ban',
      createdAt: MoreThanOrEqual(since),
      unbannedAt: IsNull(),
    },
    order: { createdAt: 'DESC' },
  });
  if (!log) return;

  log.unbannedAt = new Date();
  log.unbannedBy = executorId;
  await repo.save(log);

  enhancedLogger.info(`Bait ban for ${userId} in ${guildId} reversed by ${executorId}`, LogCategory.SECURITY, {
    guildId,
    userId,
    unbannedBy: executorId,
    originalLogId: log.id,
  });
}
