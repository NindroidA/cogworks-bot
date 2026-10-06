/**
 * Boot / shutdown helpers for src/index.ts, kept here so they're unit-testable
 * (index.ts runs the bot on import).
 *
 * - runInitStep: isolates one clientReady init step, so a failure is logged
 *   and the remaining steps still run.
 * - PERIODIC_JOBS: every background checker in one table, started and stopped
 *   together, so a test can assert that each one is actually scheduled.
 * - flushAnalyticsOnShutdown: persist buffered analytics counters before exit.
 */

import type { Client } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { AnalyticsConfig } from '../typeorm/entities/analytics/AnalyticsConfig';
import { activityTracker } from './analytics/activityTracker';
import { checkAndSendWeeklySummaries } from './baitChannel/weeklySummary';
import { INTERVALS } from './constants';
import { classifyError, ErrorSeverity, logError } from './errorHandler';
import { checkAndSendReminders } from './event/reminderChecker';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';
import { checkAndAutoCloseTickets } from './ticket/autoClose';
import { checkAndAlertSlaBreaches } from './ticket/slaChecker';

/**
 * Run one init step. A throw or rejection is logged (HIGH, so the error
 * reporter sees it) and swallowed, so later steps still run.
 * @returns whether the step succeeded
 */
export async function runInitStep(name: string, step: () => unknown): Promise<boolean> {
  try {
    await step();
    return true;
  } catch (error) {
    logError({
      category: classifyError(error).category,
      severity: ErrorSeverity.HIGH,
      message: `Startup step failed: ${name} (continuing with the remaining steps)`,
      error,
      context: { step: name },
    });
    return false;
  }
}

export interface PeriodicJob {
  name: string;
  intervalMs: number;
  run: (client: Client) => Promise<void>;
}

export const PERIODIC_JOBS: readonly PeriodicJob[] = [
  // Ticks hourly; only sends on Sunday 00:xx UTC.
  { name: 'bait weekly summary', intervalMs: INTERVALS.WEEKLY_SUMMARY, run: checkAndSendWeeklySummaries },
  { name: 'ticket auto-close', intervalMs: INTERVALS.AUTO_CLOSE_CHECK, run: checkAndAutoCloseTickets },
  { name: 'ticket SLA breach', intervalMs: INTERVALS.SLA_CHECK, run: checkAndAlertSlaBreaches },
  { name: 'event reminders', intervalMs: INTERVALS.REMINDER_CHECK, run: checkAndSendReminders },
];

/**
 * Wrap a job for setInterval: never rejects, and skips a tick while the
 * previous one is still running (a slow reminder run must not post the same
 * reminder twice).
 */
export function createJobTick(job: PeriodicJob, client: Client): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await job.run(client);
    } catch (error) {
      enhancedLogger.error(`Periodic job failed: ${job.name}`, error as Error, LogCategory.ERROR);
    } finally {
      running = false;
    }
  };
}

const jobTimers: ReturnType<typeof setInterval>[] = [];

export function startPeriodicJobs(client: Client, jobs: readonly PeriodicJob[] = PERIODIC_JOBS): void {
  stopPeriodicJobs();
  for (const job of jobs) {
    const tick = createJobTick(job, client);
    jobTimers.push(setInterval(() => void tick(), job.intervalMs));
  }
  enhancedLogger.info(`Started ${jobs.length} periodic jobs`, LogCategory.SYSTEM, { jobs: jobs.map(j => j.name) });
}

export function stopPeriodicJobs(): void {
  for (const timer of jobTimers) clearInterval(timer);
  jobTimers.length = 0;
}

/**
 * Flush the in-memory analytics counters of analytics-enabled guilds, so a
 * deploy or restart doesn't drop the day so far. Bounded by `timeoutMs` so a
 * slow database can't hold up process exit.
 */
export async function flushAnalyticsOnShutdown(
  client: Client,
  timeoutMs: number = INTERVALS.ANALYTICS_SHUTDOWN_FLUSH,
): Promise<void> {
  if (!AppDataSource.isInitialized) return;

  const flush = async () => {
    const enabled = await AppDataSource.getRepository(AnalyticsConfig).find({ where: { enabled: true } });
    const memberCounts = new Map<string, number>();
    for (const { guildId } of enabled) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) memberCounts.set(guildId, guild.memberCount);
    }
    await activityTracker.flushAll(memberCounts);
    return 'flushed' as const;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    if ((await Promise.race([flush(), timeout])) === 'timeout') {
      enhancedLogger.warn(`Analytics shutdown flush timed out after ${timeoutMs}ms`, LogCategory.DATABASE);
    }
  } catch (error) {
    enhancedLogger.error('Analytics shutdown flush failed', error as Error, LogCategory.DATABASE);
  } finally {
    clearTimeout(timer);
  }
}
