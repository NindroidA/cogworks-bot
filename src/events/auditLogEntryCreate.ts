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
 * 2. **Detect mod-supersedes-us.** When a mod (or another bot) bans, kicks
 *    or times out a user (`executorId !== client.user.id`), we:
 *    - Write an `idempotency_keys` row with the bare action, in any guild
 *      with bait enabled (or with bait pending on the user), so an
 *      `executeBanAction` for a post made before it, in flight or later,
 *      sees it as covering (banExecutor's COVERED_BY) and skips.
 *    - Only when bait is pending on the user (a `pending_actions` row, or a
 *      recent bait log nothing has enforced yet): delete the retry rows the
 *      mod's action covers, and mark the bait log
 *      `actionTaken='superseded-by-mod'` with `executorId=mod.id` so the
 *      dashboard surfaces what happened. Other moderation writes no logs.
 *
 * 3. **Track unbans.** A mod's `MEMBER_BAN_REMOVE` updates the most-recent
 *    BaitChannelLog ban row for the user with `unbannedAt` + `unbannedBy`.
 *    Useful for false-positive analytics (an admin overriding a bait ban
 *    is a signal that the bait config may be too aggressive). The bot's own
 *    unbans only finish a softban, so they are skipped.
 *
 * Required intent: `GuildModeration` (set in `src/index.ts` client config).
 */

import { AuditLogEvent, type Client, Events, type GuildAuditLogsEntry } from 'discord.js';
import { In, IsNull, MoreThanOrEqual } from 'typeorm';
import { AppDataSource } from '../typeorm';
import { BaitChannelConfig } from '../typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../typeorm/entities/bait/BaitChannelLog';
import { IdempotencyKey } from '../typeorm/entities/bait/IdempotencyKey';
import { PendingAction, type PendingActionType } from '../typeorm/entities/bait/PendingAction';
import type { ExtendedClient } from '../types/ExtendedClient';
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
 * Queued bait actions a mod's action makes redundant. A ban covers them all,
 * including the unban that finishes one of our softbans (it must not lift the
 * mod's ban); a kick covers a kick or timeout but not a ban (a ban by user ID
 * still works on a non-member); a timeout covers only a timeout.
 */
const MOD_ACTION_COVERS: Record<'ban' | 'kick' | 'timeout', readonly PendingActionType[]> = {
  ban: ['ban', 'softban', 'kick', 'timeout', 'log-only', 'unban'],
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
        // The bot only unbans to finish a softban: that isn't a reversal.
        if (!isSelf) await handleUnban(guild.id, targetId, executorId, entry.id);
        return;
      }

      if (isSelf) {
        await confirmSelfAction(guild.id, targetId, entry.id, entry.reason, retryDelays);
      } else {
        await handleModSupersedes(client, guild.id, targetId, executorId, action, entry.id);
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

/** The guild's bait config, from the manager's cache when the bot is running. */
async function loadBaitConfig(client: Client, guildId: string): Promise<BaitChannelConfig | null> {
  const manager = (client as ExtendedClient).baitChannelManager as ExtendedClient['baitChannelManager'] | undefined;
  if (manager) return manager.getCachedConfig(guildId);
  return AppDataSource.getRepository(BaitChannelConfig).findOne({ where: { guildId } });
}

/**
 * Write the mod's idempotency key: the bare action, dated now (banExecutor
 * reads `expiresAt - TTL` as when it was taken, and a key covers posts made
 * before that). A second same-day action of the same kind hits
 * UNIQUE(guildId, userId, action, dayBucket); the existing key is re-dated
 * and re-attributed instead, or posts made between the two actions would
 * stay uncovered. Bait keys hold `<action>:<messageId>`, so a bare key is
 * always a mod's.
 */
async function claimModKey(
  guildId: string,
  userId: string,
  action: 'ban' | 'kick' | 'timeout',
  executorId: string,
): Promise<void> {
  const repo = AppDataSource.getRepository(IdempotencyKey);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
  try {
    await repo.save(
      repo.create({ guildId, userId, action, dayBucket: todayUtc(), executorId, testMode: false, expiresAt }),
    );
  } catch {
    try {
      await repo.update({ guildId, userId, action }, { executorId, expiresAt });
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to record a mod action as a bait idempotency key',
        error,
        context: { guildId, userId, action },
      });
    }
  }
}

/**
 * Mod-supersedes-us path: a non-bot executor performed the action. Its key is
 * claimed whenever bait could act on the user; rows and logs are touched only
 * when bait is pending on them.
 */
async function handleModSupersedes(
  client: Client,
  guildId: string,
  userId: string,
  executorId: string,
  action: 'ban' | 'kick' | 'timeout',
  auditLogId: string,
): Promise<void> {
  const pendingRepo = AppDataSource.getRepository(PendingAction);
  const logRepo = AppDataSource.getRepository(BaitChannelLog);

  // Step 1: claim the mod's key first, in any guild with bait enabled. A
  // bait action can be in flight with no pending row (instant action, or a
  // grace timer that already removed its row), and only this key stops it
  // from undoing the mod's action: a softban's unban lifting the mod's ban,
  // or a timeout shortening theirs. It covers posts made before now only.
  const config = await loadBaitConfig(client, guildId);
  if (config?.enabled) await claimModKey(guildId, userId, action, executorId);

  // Is bait pending on this user? A live pending_actions row (grace or
  // retry; dead-lettered rows stay for the dashboard review queue) or a
  // recent log nothing has enforced yet. Otherwise it's ordinary
  // moderation: no rows are deleted and no bait log is written.
  const pending = await pendingRepo.find({ where: { guildId, userId, deadAt: IsNull() } });
  const since = new Date(Date.now() - RECENT_LOG_WINDOW_MS);
  const existingLog = await logRepo.findOne({
    where: { guildId, userId, actionTaken: In(NON_FINAL_STATES), createdAt: MoreThanOrEqual(since) },
    order: { createdAt: 'DESC' },
  });
  if (pending.length === 0 && !existingLog) return;
  // Bait turned off since, but a row or log is still open: the retry queue
  // still runs an unban (the rest of our softban) then, so the key is still
  // needed.
  if (!config?.enabled) await claimModKey(guildId, userId, action, executorId);

  // Step 2: delete the retry rows (attempts >= 1) the mod's action covers, so
  // they end now with a superseded-by-mod log instead of spending a retry (a
  // kicked user's timeout would otherwise run as a softban). A retry it
  // doesn't cover (a ban after a mod's timeout) is still owed. Grace rows
  // (attempts = 0) stay with the manager: its timer re-checks current state,
  // sees a ban as a leave, and skips an action the key above covers.
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
