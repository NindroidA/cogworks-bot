/**
 * Retry queue for bait moderation actions that returned `status: 'queued'`
 * from the ban executor (network errors, Discord 429/5xx, transient
 * failures).
 *
 * Storage: re-uses the `pending_actions` table. A row's role is signalled
 * by `attempts`:
 *   - `attempts = 0` → grace-period entry (the setTimeout-driven path)
 *   - `attempts ≥ 1` → retry entry (this queue's territory)
 *   - `deadAt != null` → dead-lettered, won't be retried
 *
 * Backoff: exponential. 5s → 30s → 5min → dead-letter. Three attempts
 * total; anything still failing after that needs human attention (and a
 * mod-log alert).
 *
 * Tick interval: every 15s the queue scans for rows where `deadAt IS NULL
 * AND attempts >= 1 AND expiresAt < NOW()`, locks them by updating expiresAt
 * forward (optimistic), and dispatches `executeBanAction` for each. Result:
 *   - `executed` → DELETE row
 *   - `duplicate` → DELETE row (already done by something else)
 *   - `queued` again → attempts++, set expiresAt to next backoff
 *   - `failed` (terminal) → set `deadAt = now()`, leave the row for mod
 *     review via the dashboard's pending-actions list (Phase 6 API)
 *
 * Grace rows (attempts = 0) are never executed here. The manager's timer
 * settles them against current config, test mode, whitelist and whether the
 * user deleted their message; this queue knows none of that. A grace row
 * still present well past its window lost its timer, so it is dropped.
 */

import type { Client, Guild } from 'discord.js';
import { IsNull, LessThan, type Repository } from 'typeorm';
import type { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import type { IdempotencyKey } from '../../typeorm/entities/bait/IdempotencyKey';
import type { PendingAction, PendingActionType } from '../../typeorm/entities/bait/PendingAction';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { executeBanAction } from './banExecutor';

const TICK_INTERVAL_MS = 15_000;

/**
 * A grace row only counts as orphaned this long after its window closed. The
 * live timer fires at about expiresAt and then awaits a REST fetch before it
 * removes the row, and DATETIME rounding can make expiresAt up to 0.5s early,
 * so a smaller margin would sweep rows the timer still owns.
 */
export const ORPHAN_GRACE_MARGIN_MS = 60_000;

/**
 * Backoff schedule. Index = attempts that have already happened (0-indexed).
 * After attempts=1 (one failure recorded), wait 5s. After 2 failures, 30s.
 * After 3, dead-letter.
 */
const BACKOFF_MS = [5_000, 30_000, 5 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length; // 3

export interface RetryQueueDeps {
  client: Client;
  pendingActionRepo: Repository<PendingAction>;
  idempotencyRepo: Repository<IdempotencyKey>;
  /**
   * Injectable for tests — defaults to the real REST executor. Passing a fake
   * here lets the retry-lifecycle tests drive executed/queued/failed outcomes
   * without `mock.module()` (which is process-shared on bun and would poison
   * the sibling banExecutor suite).
   */
  executeBanAction?: typeof executeBanAction;
  /**
   * The guild's current bait config (test mode, delete window, timeout
   * length). Defaults to the client-attached manager's cached lookup.
   */
  getConfig?: (guildId: string) => Promise<BaitChannelConfig | null>;
}

type ClientWithBaitConfig = Client & {
  baitChannelManager?: { getCachedConfig(guildId: string): Promise<BaitChannelConfig | null> };
};

export class RetryQueue {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private deps: RetryQueueDeps) {}

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    enhancedLogger.info('Bait retry queue started', LogCategory.SYSTEM, {
      tickIntervalMs: TICK_INTERVAL_MS,
    });
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  /**
   * Enqueue (or update) a row when `executeBanAction` returned
   * `status: 'queued'`. Idempotent — if a row for this action already
   * exists, attempts is incremented and the row is reused.
   */
  async enqueue(params: {
    guildId: string;
    userId: string;
    messageId: string;
    channelId: string;
    action: PendingActionType;
    suspicionScore: number;
    lastError?: string;
    warningMessageId?: string | null;
  }): Promise<void> {
    const { pendingActionRepo } = this.deps;
    const existing = await pendingActionRepo.findOne({
      where: {
        guildId: params.guildId,
        userId: params.userId,
        messageId: params.messageId,
      },
    });

    if (existing) {
      existing.attempts = Math.max(1, (existing.attempts ?? 0) + 1);
      existing.lastError = params.lastError ?? existing.lastError ?? null;
      existing.action = params.action;
      const backoffIdx = Math.min(existing.attempts - 1, BACKOFF_MS.length - 1);
      existing.expiresAt = new Date(Date.now() + BACKOFF_MS[backoffIdx]);
      if (existing.attempts >= MAX_ATTEMPTS) {
        existing.deadAt = new Date();
        await this.alertDeadLetter(existing);
      }
      await pendingActionRepo.save(existing);
      return;
    }

    // Fresh queue row (first failure on an action that didn't have a grace
    // period — e.g. instant-ban path on score ≥ 90).
    const entity = pendingActionRepo.create({
      guildId: params.guildId,
      userId: params.userId,
      messageId: params.messageId,
      channelId: params.channelId,
      action: params.action,
      suspicionScore: params.suspicionScore,
      attempts: 1,
      lastError: params.lastError ?? null,
      warningMessageId: params.warningMessageId ?? null,
      expiresAt: new Date(Date.now() + BACKOFF_MS[0]),
    });
    await pendingActionRepo.save(entity);
  }

  /**
   * Tick: process all due retry rows.
   *
   * Concurrency: the tick re-entrancy guard prevents overlapping runs. If a
   * tick is still in flight when the next interval fires, we skip — the next
   * one picks up where we left off (rows have backoff timestamps anyway).
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const due = await this.deps.pendingActionRepo.find({
        where: {
          deadAt: IsNull(),
          expiresAt: LessThan(new Date()),
        },
        take: 50, // safety cap per tick
      });

      // Filter to retry rows (attempts >= 1). Grace-period rows
      // (attempts = 0) are owned by the manager's setTimeout — we leave
      // them alone unless they're well past the margin (cleanup pass below).
      const retryRows = due.filter(r => (r.attempts ?? 0) >= 1);
      const orphanCutoff = Date.now() - ORPHAN_GRACE_MARGIN_MS;
      const orphanedGrace = due.filter(r => (r.attempts ?? 0) === 0 && r.expiresAt.getTime() < orphanCutoff);

      for (const row of retryRows) {
        await this.processRow(row);
      }

      for (const row of orphanedGrace) {
        await this.dropOrphanedGrace(row);
      }
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.MEDIUM,
        message: 'Bait retry queue tick failed',
        error,
        context: {},
      });
    } finally {
      this.running = false;
    }
  }

  private async processRow(row: PendingAction): Promise<void> {
    const guild = await this.deps.client.guilds.fetch(row.guildId).catch(() => null);
    if (!guild) {
      // Bot no longer in this guild — terminal.
      row.deadAt = new Date();
      row.lastError = 'guild not accessible';
      await this.deps.pendingActionRepo.save(row);
      return;
    }

    const result = await this.attemptAction(guild, row);

    if (result.status === 'executed' || result.status === 'duplicate') {
      await this.deps.pendingActionRepo.remove(row);
      enhancedLogger.info(
        `Bait retry succeeded: ${row.action} on ${row.userId} (attempts=${row.attempts})`,
        LogCategory.SECURITY,
        {
          guildId: row.guildId,
          userId: row.userId,
          action: row.action,
          attempts: row.attempts,
        },
      );
      return;
    }

    // Still failing — increment attempts, set next backoff, or dead-letter.
    row.attempts = (row.attempts ?? 0) + 1;
    row.lastError = result.failureReason ?? row.lastError;

    if (result.status === 'failed' || row.attempts >= MAX_ATTEMPTS) {
      row.deadAt = new Date();
      await this.alertDeadLetter(row);
    } else {
      const backoffIdx = Math.min(row.attempts - 1, BACKOFF_MS.length - 1);
      row.expiresAt = new Date(Date.now() + BACKOFF_MS[backoffIdx]);
    }
    await this.deps.pendingActionRepo.save(row);
  }

  /**
   * A grace row whose timer is gone (lost across a restart, or its delete
   * failed). Drop it without acting: nothing here can tell whether the user
   * deleted their message, got whitelisted, or the guild switched to test
   * mode, and boot-time restore never acts on grace rows either.
   */
  private async dropOrphanedGrace(row: PendingAction): Promise<void> {
    await this.deps.pendingActionRepo.remove(row);
    enhancedLogger.warn(
      `Dropped orphaned bait grace row without acting (${row.action} on ${row.userId} in ${row.guildId})`,
      LogCategory.SECURITY,
      {
        guildId: row.guildId,
        userId: row.userId,
        age: Date.now() - row.createdAt.getTime(),
      },
    );
  }

  /**
   * Attempt the action via the REST executor. The action stored on the row
   * is authoritative — we don't re-resolve via config (config may have
   * changed since the original detection, but the row's `action` is what
   * the user is owed). Test mode is the exception: a guild in test mode
   * gets a dry run, never a real action.
   */
  private async attemptAction(guild: Guild, row: PendingAction): Promise<{ status: string; failureReason?: string }> {
    const member = await guild.members.fetch(row.userId).catch(() => null);
    const config = await this.loadConfig(row.guildId);

    // For timeout, we need a live member. If they're gone, demote to softban
    // so the action still has effect (messages get purged, account barred for
    // 0ms which is effectively a "delete + soft-eject").
    let action = row.action as PendingActionType;
    if (action === 'timeout' && !member) {
      action = 'softban';
    }

    const exec = this.deps.executeBanAction ?? executeBanAction;
    return exec(
      {
        guild,
        userId: row.userId,
        action,
        reason: `cogworks:bait retry attempt=${row.attempts + 1} score=${row.suspicionScore}`,
        executorId: this.deps.client.user?.id ?? null,
        deleteMessageSeconds:
          action === 'ban' || action === 'softban' ? (config?.deleteMessageHours ?? 24) * 3600 : undefined,
        timeoutMs: action === 'timeout' ? (config?.timeoutDurationMinutes ?? 60) * 60 * 1000 : undefined,
        member: member ?? undefined,
        testMode: config?.testMode === true,
      },
      this.deps.idempotencyRepo,
    );
  }

  private async loadConfig(guildId: string): Promise<BaitChannelConfig | null> {
    try {
      if (this.deps.getConfig) return await this.deps.getConfig(guildId);
      const manager = (this.deps.client as ClientWithBaitConfig).baitChannelManager;
      return manager ? await manager.getCachedConfig(guildId) : null;
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.LOW,
        message: 'Bait retry queue could not load guild config; using defaults',
        error,
        context: { guildId },
      });
      return null;
    }
  }

  private async alertDeadLetter(row: PendingAction): Promise<void> {
    // Log loudly — operators need to know. Phase 6's pending-actions API
    // surfaces these rows for review.
    logError({
      category: ErrorCategory.DISCORD_API,
      severity: ErrorSeverity.HIGH,
      message: `Bait action dead-lettered after ${row.attempts} attempts: ${row.action} on ${row.userId}`,
      error: new Error(row.lastError ?? 'unknown'),
      context: {
        guildId: row.guildId,
        userId: row.userId,
        action: row.action,
        attempts: row.attempts,
        lastError: row.lastError,
      },
    });
  }
}

// Module-level singleton wired in `src/index.ts` boot. Tests construct
// their own instance directly.
let _instance: RetryQueue | null = null;

export function initRetryQueue(deps: RetryQueueDeps): RetryQueue {
  _instance = new RetryQueue(deps);
  return _instance;
}

export function getRetryQueue(): RetryQueue | null {
  return _instance;
}

export function stopRetryQueue(): void {
  _instance?.stop();
  _instance = null;
}
