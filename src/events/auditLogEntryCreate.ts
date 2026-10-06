/**
 * `GuildAuditLogEntryCreate` event listener for bait moderation attribution.
 *
 * Fires when Discord writes an audit-log entry — in real time, no polling.
 * Used to:
 *
 * 1. **Attribute bot-self actions.** When the bot itself just executed a
 *    bait ban/kick/timeout via `banExecutor`, the matching audit entry's
 *    `executorId` will be our `client.user.id` and its reason starts with
 *    `cogworks:bait`. We find the BaitChannelLog enforcement row for it
 *    (by the `msgId=` in the reason when there is one) and patch in
 *    `discordAuditLogId` + `actionConfirmedAt`. This closes the
 *    correlation gap: previously, an admin reading the bait log could
 *    see "we banned user X with suspicion=87" but had no link back to
 *    the actual Discord audit log entry.
 *
 * 2. **Detect mod-supersedes-us.** When a mod (or another bot) acts on a
 *    user a bait detection is pending on (a `pending_actions` row, or a
 *    recent bait log nothing has enforced yet), the audit entry's
 *    `executorId !== client.user.id`. Other moderation is ignored. We:
 *    - Delete the retry rows the mod's action covers (so the retry queue
 *      doesn't try to re-execute over the mod's action).
 *    - Write an `idempotency_keys` row (so any in-flight
 *      `executeBanAction` call sees the dup and short-circuits).
 *    - Mark the bait log `actionTaken='superseded-by-mod'` with
 *      `executorId=mod.id` so the dashboard surfaces what happened.
 *
 * 3. **Track unbans.** `MEMBER_BAN_REMOVE` updates the most-recent
 *    BaitChannelLog ban row for the user with `unbannedAt` + `unbannedBy`.
 *    Useful for false-positive analytics (an admin overriding a bait ban
 *    is a signal that the bait config may be too aggressive).
 *
 * Required intent: `GuildModeration` (set in `src/index.ts` client config).
 */

import { AuditLogEvent, type Client, Events, type GuildAuditLogsEntry } from 'discord.js';
import { In, IsNull, MoreThanOrEqual } from 'typeorm';
import { AppDataSource } from '../typeorm';
import { BaitChannelLog } from '../typeorm/entities/bait/BaitChannelLog';
import { IdempotencyKey } from '../typeorm/entities/bait/IdempotencyKey';
import { PendingAction, type PendingActionType } from '../typeorm/entities/bait/PendingAction';
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
 * The bot's audit entry usually lands before executeAction writes the log
 * row (the row comes last, after the DM, purge and log-channel post), so a
 * miss is looked up again after each of these delays.
 */
const CONFIRM_RETRY_DELAYS_MS = [10_000, 60_000];

/** A bait audit reason (auditReason.ts), bare or behind a prefix such as banExecutor's `Softban — `. */
const BAIT_REASON_RE = /(?:^|— )cogworks:bait\b/;

/** BaitChannelLog values for an action the bot enforced (or queued for retry). */
const ENFORCEMENT_STATES = ['ban', 'kick', 'softban', 'timeout', 'queued'];

/** BaitChannelLog values nothing has enforced yet, which a mod's action can settle. */
const NON_FINAL_STATES = ['queued', 'failed', 'logged'];

/**
 * Queued bait actions a mod's action makes redundant. A ban covers them all;
 * a kick covers a kick or timeout but not a ban (a ban by user ID still works
 * on a non-member); a timeout covers only a timeout.
 */
const MOD_ACTION_COVERS: Record<'ban' | 'kick' | 'timeout', readonly PendingActionType[]> = {
  ban: ['ban', 'softban', 'kick', 'timeout', 'log-only'],
  kick: ['kick', 'timeout', 'log-only'],
  timeout: ['timeout'],
};

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

export function registerAuditLogEntryCreateHandler(
  client: Client,
  opts: { confirmRetryDelaysMs?: number[] } = {},
): void {
  const retryDelays = opts.confirmRetryDelaysMs ?? CONFIRM_RETRY_DELAYS_MS;
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
        await confirmSelfAction(guild.id, targetId, entry.id, entry.reason, retryDelays);
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
 * Bot-self path: find the BaitChannelLog enforcement row for this action and
 * patch in audit correlation fields. Only bait actions count: the reason
 * starts with `cogworks:bait`, or has it after a `— ` prefix (the ban half of
 * a softban, how a bait kick usually runs, reads `Softban — cogworks:bait …`).
 * The row is matched on the reason's `msgId=` when it has one, so an earlier
 * whitelisted or deleted-in-time row is never stamped. A row that isn't
 * written yet is looked up again after each delay in `retryDelaysMs`.
 */
async function confirmSelfAction(
  guildId: string,
  userId: string,
  auditLogId: string,
  reason: string | null,
  retryDelaysMs: number[],
): Promise<void> {
  if (!reason || !BAIT_REASON_RE.test(reason)) return; // not a bait action
  const messageId = /\bmsgId=(\d+)/.exec(reason)?.[1];
  const repo = AppDataSource.getRepository(BaitChannelLog);
  const since = new Date(Date.now() - RECENT_LOG_WINDOW_MS);

  const log = await repo.findOne({
    where: {
      guildId,
      userId,
      ...(messageId ? { messageId } : {}),
      actionTaken: In(ENFORCEMENT_STATES),
      createdAt: MoreThanOrEqual(since),
    },
    order: { createdAt: 'DESC' },
  });

  if (!log) {
    const [delay, ...rest] = retryDelaysMs;
    if (delay === undefined) return; // never written (or outside the window): leave it
    const timer = setTimeout(() => {
      confirmSelfAction(guildId, userId, auditLogId, reason, rest).catch(error =>
        logError({
          category: ErrorCategory.DATABASE,
          severity: ErrorSeverity.LOW,
          message: 'Bait audit confirmation retry failed',
          error,
          context: { guildId, userId, auditLogId },
        }),
      );
    }, delay);
    timer.unref?.();
    return;
  }
  // A conditional UPDATE, not save(): it is idempotent, and it can't
  // re-insert a row that guildDelete removed after the lookup.
  const result = await repo.update(
    { id: log.id, guildId, actionConfirmedAt: IsNull() },
    { discordAuditLogId: auditLogId, actionConfirmedAt: new Date() },
  );
  if (!result.affected) return; // already confirmed, or gone

  enhancedLogger.debug(`Bait log ${log.id} confirmed via audit entry ${auditLogId}`, LogCategory.SECURITY, {
    guildId,
    userId,
    auditLogId,
  });
}

/**
 * Mod-supersedes-us path: a non-bot executor performed the action. Acts only
 * when bait is still pending on the user; then it cancels the queued retries
 * the mod's action covers and writes the idempotency key so any in-flight
 * call sees the dup.
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

  // Step 0: is bait pending on this user? A live pending_actions row (grace
  // or retry; dead-lettered rows stay for the dashboard review queue) or a
  // recent log nothing has enforced yet. Anything else is ordinary moderation:
  // it must not claim the idempotency key (a same-day bait action of that
  // kind would then be skipped), cancel rows, or write bait logs.
  const pending = await pendingRepo.find({ where: { guildId, userId, deadAt: IsNull() } });
  const since = new Date(Date.now() - RECENT_LOG_WINDOW_MS);
  const existingLog = await logRepo.findOne({
    where: { guildId, userId, actionTaken: In(NON_FINAL_STATES), createdAt: MoreThanOrEqual(since) },
    order: { createdAt: 'DESC' },
  });
  if (pending.length === 0 && !existingLog) return;

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

  // Step 2: delete the retry rows (attempts >= 1) the mod's action covers.
  // The retry queue would otherwise re-execute over it (or 10026 and
  // dead-letter). A retry it doesn't cover (a ban after a mod's timeout) is
  // still owed. Grace rows (attempts = 0) stay with the manager: its timer
  // re-checks current state, sees a ban as a leave, and dedupes a same-kind
  // action on the key above.
  const covers = MOD_ACTION_COVERS[action];
  const retries = pending.filter(r => r.attempts > 0);
  const covered = retries.filter(r => covers.includes(r.action));
  if (covered.length > 0) await pendingRepo.delete({ guildId, id: In(covered.map(r => r.id)) });
  const stillOwed = covered.length < retries.length;

  // Step 3: log the superseded event.
  //   (a) Recent non-final log row ('queued' / 'failed' / 'logged') and no
  //       retry still owed → update it in place to 'superseded-by-mod'.
  //   (b) No such row but a retry was cancelled (its 'queued' row is older
  //       than the window) → insert a minimal-metadata row so the dashboard
  //       can see the mod-supersedes event.
  //   Otherwise leave it: a retry still owed will settle the row, and a
  //   live grace entry logs its own outcome.
  if (existingLog && !stillOwed) {
    // (a) update in place
    existingLog.actionTaken = 'superseded-by-mod';
    existingLog.executorId = executorId;
    existingLog.discordAuditLogId = auditLogId;
    existingLog.actionConfirmedAt = new Date();
    await logRepo.save(existingLog);
  } else if (!existingLog && covered.length > 0) {
    // (b) Score/flags/content are unknown here, but guildId + userId +
    // executor + action + audit log ID is enough for the dashboard to correlate.
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

  enhancedLogger.info(
    `Mod ${executorId} superseded bait ${action} against ${userId} in ${guildId} (cancelled ${covered.length} retry row(s))`,
    LogCategory.SECURITY,
    {
      guildId,
      userId,
      executorId,
      action,
      auditLogId,
      pendingCancelled: covered.length,
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
