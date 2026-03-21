/**
 * Snapshot Job — Daily midnight UTC job.
 *
 * For each guild with analytics enabled:
 * 1. Flush in-memory counters to AnalyticsSnapshot
 * 2. Clean old snapshots (90+ days)
 *
 * Also runs the digest sender for guilds with digest channels configured.
 */

import type { Client } from 'discord.js';
import { LessThan } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { AnalyticsConfig } from '../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../typeorm/entities/analytics/AnalyticsSnapshot';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { activityTracker } from './activityTracker';
import { sendDigest } from './digestBuilder';

/** Retention period for analytics snapshots */
const ANALYTICS_RETENTION_DAYS = 90;

/** Interval handle for cleanup (so it can be cleared on shutdown) */
let snapshotInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Calculate milliseconds until next midnight UTC.
 */
function msUntilMidnightUtc(): number {
  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return tomorrow.getTime() - now.getTime();
}

/**
 * Run the daily snapshot flush and cleanup.
 */
async function runDailySnapshot(client: Client): Promise<void> {
  enhancedLogger.info('Running daily analytics snapshot job', LogCategory.SYSTEM);

  const configRepo = AppDataSource.getRepository(AnalyticsConfig);
  const snapshotRepo = AppDataSource.getRepository(AnalyticsSnapshot);

  try {
    // Get all guilds with analytics enabled
    const enabledConfigs = await configRepo.find({ where: { enabled: true } });

    if (enabledConfigs.length === 0) {
      enhancedLogger.info(
        'No guilds with analytics enabled, skipping snapshot',
        LogCategory.SYSTEM,
      );
      return;
    }

    // Build guildId -> memberCount map from the Discord client cache
    const guildMemberCounts = new Map<string, number>();
    for (const config of enabledConfigs) {
      const guild = client.guilds.cache.get(config.guildId);
      if (guild) {
        guildMemberCounts.set(config.guildId, guild.memberCount);
      }
    }

    // Flush all in-memory counters
    await activityTracker.flushAll(guildMemberCounts);

    // Also flush for guilds with no activity (to record member count)
    for (const config of enabledConfigs) {
      if (!activityTracker.hasCounters(config.guildId)) {
        const memberCount = guildMemberCounts.get(config.guildId) ?? 0;
        await activityTracker.flushSnapshot(config.guildId, memberCount);
      }
    }

    // Clean stale in-memory entries
    activityTracker.cleanStaleEntries();

    // Clean old snapshots (90+ days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - ANALYTICS_RETENTION_DAYS);

    const deleteResult = await snapshotRepo.delete({
      date: LessThan(cutoffDate),
    });

    if (deleteResult.affected && deleteResult.affected > 0) {
      enhancedLogger.info(
        `Cleaned ${deleteResult.affected} old analytics snapshots`,
        LogCategory.DATABASE,
      );
    }

    // Send digests for configured guilds
    const today = new Date();
    for (const config of enabledConfigs) {
      if (!config.digestChannelId) continue;

      try {
        await sendDigest(client, config, today);
      } catch (error) {
        enhancedLogger.error(
          'Failed to send analytics digest',
          error as Error,
          LogCategory.SYSTEM,
          { guildId: config.guildId },
        );
      }
    }

    enhancedLogger.info(
      `Analytics snapshot job complete: ${enabledConfigs.length} guilds processed`,
      LogCategory.SYSTEM,
    );
  } catch (error) {
    enhancedLogger.error('Analytics snapshot job failed', error as Error, LogCategory.SYSTEM);
  }
}

/**
 * Start the daily snapshot scheduler.
 * Schedules the first run at midnight UTC, then repeats every 24 hours.
 */
export function startSnapshotJob(client: Client): void {
  const msToMidnight = msUntilMidnightUtc();

  enhancedLogger.info(
    `Analytics snapshot job scheduled — first run in ${Math.round(msToMidnight / 60000)} minutes`,
    LogCategory.SYSTEM,
  );

  // Schedule first run at midnight UTC
  const initialTimeout = setTimeout(() => {
    void runDailySnapshot(client);

    // Then repeat every 24 hours
    snapshotInterval = setInterval(() => void runDailySnapshot(client), 24 * 60 * 60 * 1000);
  }, msToMidnight);

  // Store timeout reference for cleanup
  (initialTimeout as unknown as { _snapshotTimeout: boolean })._snapshotTimeout = true;
}

/**
 * Stop the snapshot job (for graceful shutdown).
 */
export function stopSnapshotJob(): void {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
}
