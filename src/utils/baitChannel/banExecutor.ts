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
 * 2. **Idempotent per bait post.** Before touching the Discord API, an
 *    execution claims an `IdempotencyKey` for its post (see `claimKey`),
 *    shared by the first attempt, the retry queue and the leave-drain. A
 *    claim whose action did not land is released so a retry really runs.
 *    An action taken on the user after the post (a mod's, from
 *    `auditLogEntryCreate`, or ours for another post) covers it →
 *    `{ status: 'duplicate' }`; a later post is a new event.
 *
 * 3. **Audit-reason-aware.** The reason passed to Discord is the structured
 *    `cogworks:bait …` form from `auditReason.ts`. Mods reviewing the audit
 *    log can see WHY without internal-log access.
 *
 * Failures don't throw — they return a `{ status: 'failed', failureReason }`
 * shape that the retry queue (Phase 3) picks up.
 */

import { DiscordAPIError, type Guild, type GuildMember, SnowflakeUtil } from 'discord.js';
import type { Repository } from 'typeorm';
import type { IdempotencyKey } from '../../typeorm/entities/bait/IdempotencyKey';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { sleep } from '../time';

/** `unban` only finishes a softban whose unban step failed (see `retryAction`). */
export type BanExecutorAction = 'ban' | 'softban' | 'kick' | 'timeout' | 'log-only' | 'unban';

export interface BanExecutorOptions {
  guild: Guild;
  userId: string;
  action: BanExecutorAction;
  /** The bait message this answers; retries and the leave-drain pass the pending row's messageId. */
  eventId: string;
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
  /** Dry-run flag. Claims a test-mode key that never covers a real action. Skips Discord API. */
  testMode?: boolean;
  /** Delay between ban and unban for softban. Keep ≥500ms so Discord processes deletion. */
  softbanDelayMs?: number;
}

export type BanExecutorStatus =
  /** Action was performed (or, in test mode, dry-run logged). */
  | 'executed'
  /** This post was already handled, or an action taken on the user since it was posted covers it. */
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
  /** Set on `queued` when only this step is left: a softban whose ban landed retries as `unban`. */
  retryAction?: BanExecutorAction;
}

const DEFAULT_SOFTBAN_DELAY_MS = 500;
/** Starts the reason of every ban a softban places (see isOwnSoftban). */
const SOFTBAN_REASON_PREFIX = 'Softban — ';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h — auditLogEntryCreate imports this so the two can never drift

/**
 * Compute today's UTC midnight as the dayBucket. The key's own scope is the
 * bait post (see `claimKey`); the day only fills the UNIQUE index.
 */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Earlier actions that cover this one, when taken after the post was made:
 * the user was already banned (or timed out, or softbanned) for it. An unban
 * is covered by any ban, so finishing a softban never lifts a real ban.
 */
const COVERED_BY: Record<BanExecutorAction, readonly string[]> = {
  ban: ['ban'],
  softban: ['ban', 'softban'],
  unban: ['ban'],
  kick: ['ban', 'kick'],
  timeout: ['ban', 'timeout'],
  'log-only': [],
};

/** DATETIME columns keep whole seconds (MySQL rounds), so compare with a second of slack. */
const CLOCK_SLACK_MS = 1000;

/**
 * A bait claim's `action` value: `<action>:<eventId>`, plus `:t` in test mode
 * (mod keys hold the bare action). Fits varchar(32): 8 + 1 + 20 + 2 = 31.
 */
function claimKey(action: BanExecutorAction, eventId: string, testMode: boolean): string {
  return `${action}:${eventId}${testMode ? ':t' : ''}`;
}

/** When the post was made, from its snowflake; anything else counts as long ago. */
function postedAt(eventId: string): number {
  return /^\d{17,20}$/.test(eventId) ? SnowflakeUtil.timestampFrom(eventId) : 0;
}

/**
 * When a key's action was taken, from `expiresAt` (both writers set it to
 * now + TTL on the bot's clock; `createdAt` uses the database's clock and timezone).
 */
function actedAt(key: IdempotencyKey): number {
  return key.expiresAt.getTime() - IDEMPOTENCY_TTL_MS;
}

type Claim =
  | { claimed: true; key: string }
  | { claimed: false; reason: 'duplicate'; existing: IdempotencyKey }
  | { claimed: false; reason: 'db_error' };

/**
 * Claim the idempotency key for this post. `claimed` means this caller acts.
 * `duplicate` means an action taken on the user after the post covers it
 * (see COVERED_BY), or another caller holds this post's key right now. A
 * dry run is covered by anything; a real action never by a dry run.
 *
 * The UNIQUE index closes the race between two callers on the same post:
 * the loser's save throws, and a re-read tells a duplicate from a DB error.
 */
async function claimIdempotencyKey(
  repo: Repository<IdempotencyKey>,
  guildId: string,
  opts: { userId: string; action: BanExecutorAction; eventId: string; executorId?: string | null; testMode: boolean },
): Promise<Claim> {
  const { userId, action, eventId, testMode } = opts;
  const key = claimKey(action, eventId, testMode);
  const since = postedAt(eventId) - CLOCK_SLACK_MS;

  try {
    const prior = await repo.find({ where: { guildId, userId } });
    const covers = prior.filter(
      k => (testMode || !k.testMode) && COVERED_BY[action].includes(k.action.split(':')[0]) && actedAt(k) >= since,
    );
    // Report another action over this post's own key (see the softban case in executeBanAction).
    const cover = covers.find(k => k.action !== key) ?? covers[0];
    if (cover) return { claimed: false, reason: 'duplicate', existing: cover };
  } catch (error) {
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.HIGH,
      message: 'Idempotency lookup failed (transient DB error)',
      error,
      context: { guildId, userId, action },
    });
    return { claimed: false, reason: 'db_error' };
  }

  try {
    const entity = repo.create({
      guildId,
      userId,
      action: key,
      dayBucket: todayUtc(),
      executorId: opts.executorId ?? null,
      testMode,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
    await repo.save(entity);
    return { claimed: true, key };
  } catch (error) {
    // Either the UNIQUE constraint fired (another caller holds this post's
    // key) or the DB is unavailable. Re-read to tell them apart; if that
    // fails too or finds nothing, report a DB error so the caller queues a
    // retry rather than silently skipping enforcement.
    let existing: IdempotencyKey | null = null;
    try {
      existing = await repo.findOne({ where: { guildId, userId, action: key } });
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
 * After the Discord call. A claim whose action landed is re-dated to now, so
 * a post made while a slow (rate-limited) call was in flight is covered. One
 * whose action did not land is given back, so the retry queue (or the
 * leave-drain) can claim the same post again and actually run it. The key is
 * this post's own, never a mod's.
 */
async function settleClaim(
  repo: Repository<IdempotencyKey>,
  guildId: string,
  userId: string,
  key: string,
  landed: boolean,
): Promise<void> {
  try {
    if (landed) {
      await repo.update({ guildId, userId, action: key }, { expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) });
    } else {
      await repo.delete({ guildId, userId, action: key });
    }
  } catch (error) {
    logError({
      category: ErrorCategory.DATABASE,
      severity: landed ? ErrorSeverity.LOW : ErrorSeverity.HIGH,
      message: landed
        ? 'Failed to re-date idempotency claim'
        : 'Failed to release idempotency claim; a retry of this action will be skipped as a duplicate',
      error,
      context: { guildId, userId, key },
    });
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

/**
 * Is the user banned in this guild right now? `null` when we can't tell
 * (no BAN_MEMBERS, or the request failed). A softban lifts any ban already in
 * place, so the leave paths check this before softbanning someone who left:
 * the leave may have been a ban by a mod or another bot.
 */
export async function fetchBanState(guild: Guild, userId: string): Promise<boolean | null> {
  const ban = await fetchBan(guild, userId);
  return ban === undefined ? null : ban !== null;
}

/** The user's ban here: null when not banned, undefined when it can't be read. */
export async function fetchBan(guild: Guild, userId: string): Promise<{ reason?: string | null } | null | undefined> {
  try {
    return await guild.bans.fetch({ user: userId, force: true });
  } catch (error) {
    return isUnknownBan(error) ? null : undefined;
  }
}

const isUnknownBan = (error: unknown): boolean => error instanceof DiscordAPIError && Number(error.code) === 10026;

/** A ban one of our softbans placed (by its reason); an `unban` lifts only those. */
export const isOwnSoftban = (ban: { reason?: string | null }): boolean =>
  ban.reason?.startsWith(SOFTBAN_REASON_PREFIX) === true;

export async function executeBanAction(
  opts: BanExecutorOptions,
  idempotencyRepo: Repository<IdempotencyKey>,
): Promise<BanExecutorResult> {
  const { guild, userId, action, eventId, executorId } = opts;
  // An unban only undoes our own softban's ban, so it is never a dry run.
  const testMode = opts.testMode === true && action !== 'unban';
  const softbanDelayMs = opts.softbanDelayMs ?? DEFAULT_SOFTBAN_DELAY_MS;

  // Step 1: Claim this post's idempotency key. Distinguish three outcomes:
  //   - claimed:    we own this action, proceed to Discord API
  //   - duplicate:  already handled or covered — skip, return duplicate
  //   - db_error:   transient DB failure — queue for retry instead of
  //                 silently skipping (the bug was to treat this as duplicate)
  const claim = await claimIdempotencyKey(idempotencyRepo, guild.id, { userId, action, eventId, executorId, testMode });
  if (!claim.claimed) {
    if (claim.reason === 'duplicate') {
      // A softban covered only by its own post's key may have stopped between
      // its ban and unban (a restart): finish it as an unban, which does
      // nothing if the softban completed.
      if (!testMode && action === 'softban' && claim.existing.action === claimKey(action, eventId, false)) {
        return {
          status: 'queued',
          action,
          retryAction: 'unban',
          failureReason: 'softban may have stopped before its unban',
        };
      }
      enhancedLogger.debug(
        `Skipping ${action} on ${userId} — covered by ${claim.existing.action}${claim.existing.executorId ? ` by ${claim.existing.executorId}` : ''}`,
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

  // Step 3: Execute the action, then settle the claim (see settleClaim). A
  // softban whose ban landed keeps its claim, and only its unban is retried.
  const result = await performAction(opts, softbanDelayMs);
  await settleClaim(idempotencyRepo, guild.id, userId, claim.key, result.status === 'executed' || !!result.retryAction);
  return result;
}

/** The Discord call for executeBanAction. Failures come back as a result, never thrown. */
async function performAction(opts: BanExecutorOptions, softbanDelayMs: number): Promise<BanExecutorResult> {
  const { guild, userId, action, reason, deleteMessageSeconds, timeoutMs, member } = opts;
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
          reason: `${SOFTBAN_REASON_PREFIX}${reason}`,
          deleteMessageSeconds: deleteMessageSeconds ?? 24 * 3600,
        });
        // Brief delay so Discord finishes the message-purge step before we
        // lift the ban.
        await sleep(softbanDelayMs);
        try {
          await guild.bans.remove(userId, 'Softban complete — user may rejoin');
        } catch (removeError) {
          // Ban succeeded but unban failed → user is now permanently banned
          // by accident. Queue only the unban: rerunning the softban would
          // ban (and purge) a second time.
          if (!isTerminalDiscordError(removeError)) {
            return {
              status: 'queued',
              action,
              retryAction: 'unban',
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

      case 'unban': {
        // The rest of a softban whose unban step failed. Only a ban our
        // softban placed (by its reason) is lifted, never anyone else's; one
        // already gone (10026) leaves nothing to do.
        const ban = await fetchBan(guild, userId);
        if (ban === undefined) return { status: 'queued', action, failureReason: 'ban list unreadable' };
        if (ban && !isOwnSoftban(ban)) {
          enhancedLogger.warn(
            `Bait unban for ${userId} skipped: the ban in place is not our softban's`,
            LogCategory.SECURITY,
            {
              guildId: guild.id,
              userId,
              banReason: ban.reason ?? null,
            },
          );
          return { status: 'duplicate', action };
        }
        // A 10026 on remove: lifted by hand since the fetch, which is what we wanted.
        if (ban) {
          await guild.bans.remove(userId, 'Softban complete — user may rejoin').catch(error => {
            if (!isUnknownBan(error)) throw error;
          });
        }
        return { status: 'executed', action };
      }

      case 'kick': {
        // Kick path used only when bot lacks BAN_MEMBERS (caller checks).
        // Still requires a live member ref for now. discord.js DOES expose
        // kick-by-id (guild.members.kick(userId)) — switching to it would make
        // this arm leave-tolerant like the ban arm, but that's a deliberate
        // behavior change, tracked separately.
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
        // A longer timeout already in place (a mod's) covers this one: never shorten it.
        if ((member.communicationDisabledUntilTimestamp ?? 0) >= Date.now() + timeoutMs) {
          return { status: 'duplicate', action };
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
