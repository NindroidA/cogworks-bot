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
 */

import type { Client, Guild } from 'discord.js';
import { IsNull, LessThan, type Repository } from 'typeorm';
import type { IdempotencyKey } from '../../typeorm/entities/bait/IdempotencyKey';
import type { PendingAction, PendingActionType } from '../../typeorm/entities/bait/PendingAction';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { executeBanAction } from './banExecutor';

const TICK_INTERVAL_MS = 15_000;

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
}

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
      // them alone unless they're way overdue (cleanup pass below).
      const retryRows = due.filter(r => (r.attempts ?? 0) >= 1);
      const orphanedGrace = due.filter(r => (r.attempts ?? 0) === 0);

      for (const row of retryRows) {
        await this.processRow(row);
      }

      // Orphaned grace rows: setTimeout was lost across a bot restart and
      // the row is now past its grace window. Treat them as immediate
      // executions — but only if the executor confirms via REST, since the
      // member may have left during the offline window.
      for (const row of orphanedGrace) {
        await this.processOrphanedGrace(row);
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

  private async processOrphanedGrace(row: PendingAction): Promise<void> {
    // Bot restarted past the grace window. Either:
    //  - User is still here → execute the configured action now.
    //  - User has left → REST ban still works (leave-tolerant).
    // Both cases route through `attemptAction` (REST executor).
    const guild = await this.deps.client.guilds.fetch(row.guildId).catch(() => null);
    if (!guild) {
      row.deadAt = new Date();
      row.lastError = 'guild not accessible (orphaned grace)';
      await this.deps.pendingActionRepo.save(row);
      return;
    }

    enhancedLogger.warn(
      `Orphaned grace row promoted to retry queue (${row.action} on ${row.userId} in ${row.guildId})`,
      LogCategory.SECURITY,
      {
        guildId: row.guildId,
        userId: row.userId,
        age: Date.now() - row.createdAt.getTime(),
      },
    );

    // Don't pre-consume an attempt — `processRow`'s failure path will
    // increment from 0→1 on the first failure, then 1→2, then 2→3
    // (dead-letter). That gives the row the full 3 attempts the
    // documented backoff promises. If we'd pre-set attempts=1 here, we'd
    // only get 2 Discord retries before dead-lettering.
    await this.processRow(row);
  }

  /**
   * Attempt the action via the REST executor. The action stored on the row
   * is authoritative — we don't re-resolve via config (config may have
   * changed since the original detection, but the row's `action` is what
   * the user is owed).
   */
  private async attemptAction(guild: Guild, row: PendingAction): Promise<{ status: string; failureReason?: string }> {
    const member = await guild.members.fetch(row.userId).catch(() => null);

    // For timeout, we need a live member. If they're gone, demote to softban
    // so the action still has effect (messages get purged, account barred for
    // 0ms which is effectively a "delete + soft-eject").
    let action = row.action as PendingActionType;
    if (action === 'timeout' && !member) {
      action = 'softban';
    }

    return executeBanAction(
      {
        guild,
        userId: row.userId,
        action,
        reason: `cogworks:bait retry attempt=${row.attempts + 1} score=${row.suspicionScore}`,
        executorId: this.deps.client.user?.id ?? null,
        deleteMessageSeconds: action === 'ban' || action === 'softban' ? 24 * 3600 : undefined,
        timeoutMs: action === 'timeout' ? 60 * 60 * 1000 : undefined,
        member: member ?? undefined,
      },
      this.deps.idempotencyRepo,
    );
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
