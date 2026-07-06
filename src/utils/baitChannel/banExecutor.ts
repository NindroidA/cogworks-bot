/**
 * REST-based moderation executor for bait actions.
 *
 * Three guarantees the older `member.ban()` / `member.kick()` paths could
 * not provide:
 *
 * 1. **Leave-tolerant.** All bans/unbans flow through
 *    `guild.bans.create(userId, ...)` / `guild.bans.remove(userId, ...)` —
 *    REST endpoints addressed by user ID. They succeed even after the
 *    Discord.js `GuildMember` partial has been evicted (post-leave,
 *    post-cache-flush).
 *
 * 2. **Idempotent.** Every execution writes an `IdempotencyKey` row keyed
 *    on `(guildId, userId, action, dayBucket)` before touching the Discord
 *    API. Conflicts → return `{ status: 'duplicate' }` and skip. Closes the
 *    mod-vs-bot race (Phase 4 also writes this key from
 *    `auditLogEntryCreate` when a mod beats us to the action) and prevents
 *    retry-queue double-execution.
 *
 * 3. **Audit-reason-aware.** The reason passed to Discord is the structured
 *    `cogworks:bait …` form from `auditReason.ts`. Mods reviewing the audit
 *    log can see WHY without internal-log access.
 *
 * Failures don't throw — they return a `{ status: 'failed', failureReason }`
 * shape that the retry queue (Phase 3) picks up.
 */

import { DiscordAPIError, type Guild, type GuildMember } from 'discord.js';
import type { Repository } from 'typeorm';
import type { IdempotencyKey } from '../../typeorm/entities/bait/IdempotencyKey';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { sleep } from '../time';

export type BanExecutorAction = 'ban' | 'softban' | 'kick' | 'timeout' | 'log-only';

export interface BanExecutorOptions {
  guild: Guild;
  userId: string;
  action: BanExecutorAction;
  reason: string;
  /** Bot client.user.id when self-attributed; mod ID when superseded. */
  executorId?: string | null;
  /** For ban/softban — Discord cap is 604800 (7 days). */
  deleteMessageSeconds?: number;
  /** For timeout — required when `action === 'timeout'`. Max 28 days. */
  timeoutMs?: number;
  /**
   * Member ref — required for `timeout` and for the kick-fallback path that
   * fires when the bot lacks BAN_MEMBERS. Optional for ban/softban (we go
   * through REST). For timeout, if the member ref is gone, the executor
   * will silently demote to log-only (timeout requires a live member).
   */
  member?: GuildMember;
  /** Dry-run flag. Writes idempotency key with `testMode=true`. Skips Discord API. */
  testMode?: boolean;
  /** Delay between ban and unban for softban. Keep ≥500ms so Discord processes deletion. */
  softbanDelayMs?: number;
}

export type BanExecutorStatus =
  /** Action was performed (or, in test mode, dry-run logged). */
  | 'executed'
  /** Idempotency key already exists — someone (bot retry, mod) already did this today. */
  | 'duplicate'
  /** Action could not be executed and should be retried by the retry queue. */
  | 'queued'
  /** Permanent failure — won't be retried. */
  | 'failed';

export interface BanExecutorResult {
  status: BanExecutorStatus;
  action: BanExecutorAction;
  failureReason?: string;
  /** Discord API error code if applicable (e.g., 10007 = unknown member). */
  errorCode?: number;
}

const DEFAULT_SOFTBAN_DELAY_MS = 500;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h — auditLogEntryCreate imports this so the two can never drift

/**
 * Compute today's UTC midnight as the dayBucket. Same-day retries dedup;
 * cross-day re-attempts are accepted as repeat-offender events.
 */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Claim the idempotency key. Returns `true` if this caller is the one
 * authorized to execute; `false` if the key already exists (someone else
 * already did this).
 *
 * Implementation note: TypeORM's `save()` on a new row will trigger the
 * UNIQUE constraint and throw. We catch the duplicate-key error specifically
 * and return false. Any other error propagates.
 */
async function claimIdempotencyKey(
  repo: Repository<IdempotencyKey>,
  guildId: string,
  userId: string,
  action: BanExecutorAction,
  executorId: string | null | undefined,
  testMode: boolean,
): Promise<
  | { claimed: true }
  | { claimed: false; reason: 'duplicate'; existing: IdempotencyKey }
  | { claimed: false; reason: 'db_error' }
> {
  const dayBucket = todayUtc();
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);

  try {
    const entity = repo.create({
      guildId,
      userId,
      action,
      dayBucket,
      executorId: executorId ?? null,
      testMode,
      expiresAt,
    });
    await repo.save(entity);
    return { claimed: true };
  } catch (error) {
    // Distinguish duplicate from transient DB failure. The save failed —
    // either the UNIQUE constraint fired (someone else claimed first), or
    // the DB is unavailable. We can tell the two apart by re-reading: if
    // a row exists for our key, it was a duplicate; if the second query
    // also fails or returns null, treat as a real DB error and let the
    // caller queue for retry rather than silently skip enforcement.
    let existing: IdempotencyKey | null = null;
    try {
      existing = await repo.findOne({
        where: { guildId, userId, action, dayBucket },
      });
    } catch (lookupError) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.HIGH,
        message: 'Idempotency lookup after save failure also failed — DB likely down',
        error: lookupError,
        context: { guildId, userId, action },
      });
      return { claimed: false, reason: 'db_error' };
    }
    if (existing) {
      return { claimed: false, reason: 'duplicate', existing };
    }
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.HIGH,
      message: 'Failed to claim idempotency key (transient DB error)',
      error,
      context: { guildId, userId, action },
    });
    return { claimed: false, reason: 'db_error' };
  }
}

/**
 * Classify a Discord API error to decide whether the retry queue should
 * pick it up. 429 (rate limit) → queue. Network/5xx → queue. 4xx that is
 * not a rate limit → permanent failure.
 */
function isRetryableDiscordError(error: unknown): boolean {
  if (error instanceof DiscordAPIError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return true;
    return false;
  }
  // Non-Discord error (network, abort, etc.) — retry.
  return true;
}

/**
 * Discord API error codes that are terminal — retrying won't help.
 * 10007 = Unknown Member (already left — should not retry; demote).
 * 10026 = Unknown Ban (already removed — for softban remove step).
 * 50013 = Missing Permissions (won't fix on retry).
 */
const TERMINAL_DISCORD_CODES = new Set([10007, 10026, 50013]);

function isTerminalDiscordError(error: unknown): boolean {
  return error instanceof DiscordAPIError && TERMINAL_DISCORD_CODES.has(Number(error.code));
}

export async function executeBanAction(
  opts: BanExecutorOptions,
  idempotencyRepo: Repository<IdempotencyKey>,
): Promise<BanExecutorResult> {
  const { guild, userId, action, reason, deleteMessageSeconds, timeoutMs, member, executorId } = opts;
  const testMode = opts.testMode === true;
  const softbanDelayMs = opts.softbanDelayMs ?? DEFAULT_SOFTBAN_DELAY_MS;

  // Step 1: Claim the idempotency slot. Distinguish three outcomes:
  //   - claimed:    we own this action, proceed to Discord API
  //   - duplicate:  someone else already did this — skip, return duplicate
  //   - db_error:   transient DB failure — queue for retry instead of
  //                 silently skipping (the bug was to treat this as duplicate)
  const claim = await claimIdempotencyKey(idempotencyRepo, guild.id, userId, action, executorId, testMode);
  if (!claim.claimed) {
    if (claim.reason === 'duplicate') {
      enhancedLogger.debug(
        `Skipping ${action} on ${userId} — idempotency key already claimed${claim.existing.executorId ? ` by ${claim.existing.executorId}` : ''}`,
        LogCategory.SECURITY,
        { guildId: guild.id, userId, action },
      );
      return { status: 'duplicate', action };
    }
    // db_error — queue for retry. Caller (manager or leave-drain) forwards
    // to retryQueue.enqueue which will re-attempt the claim on a later tick.
    return {
      status: 'queued',
      action,
      failureReason: 'idempotency claim failed (DB unavailable)',
    };
  }

  // Step 2: Test mode dry-run — bail before Discord API.
  if (testMode) {
    enhancedLogger.info(`[TEST MODE] Would have executed ${action} on ${userId}`, LogCategory.SECURITY, {
      guildId: guild.id,
      userId,
      action,
    });
    return { status: 'executed', action };
  }

  // Step 3: Execute the action.
  try {
    switch (action) {
      case 'ban': {
        await guild.bans.create(userId, {
          reason,
          deleteMessageSeconds: deleteMessageSeconds ?? 24 * 3600,
        });
        return { status: 'executed', action };
      }

      case 'softban': {
        await guild.bans.create(userId, {
          reason: `Softban — ${reason}`,
          deleteMessageSeconds: deleteMessageSeconds ?? 24 * 3600,
        });
        // Brief delay so Discord finishes the message-purge step before we
        // lift the ban.
        await sleep(softbanDelayMs);
        try {
          await guild.bans.remove(userId, 'Softban complete — user may rejoin');
        } catch (removeError) {
          // Ban succeeded but unban failed → user is now permanently banned
          // by accident. Log loud, queue the unban for retry.
          if (!isTerminalDiscordError(removeError)) {
            return {
              status: 'queued',
              action,
              failureReason: `softban unban step failed: ${(removeError as Error).message}`,
              errorCode: removeError instanceof DiscordAPIError ? Number(removeError.code) : undefined,
            };
          }
          // Terminal — log and accept (user already unbanned by something else, or perms vanished).
          enhancedLogger.warn(
            `Softban remove step failed terminally for ${userId} — leaving as-is`,
            LogCategory.SECURITY,
            {
              guildId: guild.id,
              userId,
              error: (removeError as Error).message,
            },
          );
        }
        return { status: 'executed', action };
      }

      case 'kick': {
        // Kick path used only when bot lacks BAN_MEMBERS (caller checks).
        // Requires a live member ref — Discord has no REST kick-by-id endpoint
        // (well, technically `DELETE /guilds/:id/members/:id` exists, but
        // discord.js exposes it only via `member.kick()`).
        if (!member) {
          return {
            status: 'failed',
            action,
            failureReason: 'kick requires a live GuildMember ref',
          };
        }
        await member.kick(reason);
        return { status: 'executed', action };
      }

      case 'timeout': {
        if (!member) {
          // Timeout requires a live member. If they've left, demote silently.
          return {
            status: 'failed',
            action,
            failureReason: 'timeout requires a live GuildMember ref (user may have left)',
          };
        }
        if (!timeoutMs || timeoutMs <= 0) {
          return {
            status: 'failed',
            action,
            failureReason: 'timeout requires positive timeoutMs',
          };
        }
        await member.timeout(timeoutMs, reason);
        return { status: 'executed', action };
      }

      case 'log-only': {
        // No Discord side-effect, but we already claimed the idempotency key.
        return { status: 'executed', action };
      }

      default: {
        const _exhaustive: never = action;
        return {
          status: 'failed',
          action: _exhaustive,
          failureReason: 'unknown action',
        };
      }
    }
  } catch (error) {
    const errCode = error instanceof DiscordAPIError ? Number(error.code) : undefined;
    const message = error instanceof Error ? error.message : String(error);

    if (isTerminalDiscordError(error)) {
      return {
        status: 'failed',
        action,
        failureReason: message,
        errorCode: errCode,
      };
    }
    if (isRetryableDiscordError(error)) {
      return {
        status: 'queued',
        action,
        failureReason: message,
        errorCode: errCode,
      };
    }
    return {
      status: 'failed',
      action,
      failureReason: message,
      errorCode: errCode,
    };
  }
}
