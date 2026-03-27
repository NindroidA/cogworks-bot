/**
 * Legacy Data Migration System
 *
 * Runs application-level data migrations AFTER TypeORM schema sync/migrations
 * but BEFORE the bot processes events. Designed for semantic data transformations
 * that need full ORM access (not raw SQL schema changes).
 *
 * Design principles:
 * - Idempotent: safe to run multiple times (skips already-migrated data)
 * - Non-blocking: processes guilds concurrently with configurable parallelism
 * - Resilient: one guild's failure doesn't block others
 * - Observable: logs progress and results via enhancedLogger
 * - Extensible: new migrations are just objects added to a registry
 */

import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

export interface LegacyMigration {
  /** Unique identifier (e.g., 'bait-channel-ids-backfill') */
  id: string;
  /** Human-readable description for logs */
  description: string;
  /** Version this migration was introduced (e.g., '3.0.0') */
  version: string;
  /** Returns true if this guild needs migration */
  detect: (guildId: string) => Promise<boolean>;
  /** Performs the migration for a single guild */
  migrate: (guildId: string) => Promise<MigrationResult>;
}

export interface MigrationResult {
  /** Whether the migration succeeded */
  success: boolean;
  /** Number of records modified */
  changes: number;
  /** Optional description of what changed */
  details?: string;
}

export interface MigrationReport {
  totalGuilds: number;
  totalMigrations: number;
  results: MigrationReportEntry[];
  durationMs: number;
}

export interface MigrationReportEntry {
  migrationId: string;
  guildsProcessed: number;
  guildsSkipped: number;
  guildsFailed: number;
  totalChanges: number;
  failures: { guildId: string; error: string }[];
}

interface LegacyMigrationRunnerOptions {
  /** Max guilds processed in parallel (default: 5) */
  concurrency?: number;
  /** Log what would change without modifying data (default: false) */
  dryRun?: boolean;
}

/**
 * Process items with at most `limit` concurrent promises.
 * Zero dependencies, bounded memory.
 */
export async function asyncPool<T>(limit: number, items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

export class LegacyMigrationRunner {
  private migrations: LegacyMigration[] = [];
  private readonly concurrency: number;
  private readonly dryRun: boolean;

  constructor(options?: LegacyMigrationRunnerOptions) {
    this.concurrency = options?.concurrency ?? 5;
    this.dryRun = options?.dryRun ?? false;
  }

  /**
   * Register a migration. Throws if a migration with the same ID is already registered.
   */
  register(migration: LegacyMigration): void {
    if (!migration.id || !migration.description || !migration.version) {
      throw new Error(`Migration is missing required fields: id, description, version`);
    }

    if (this.migrations.some(m => m.id === migration.id)) {
      throw new Error(`Duplicate migration ID: '${migration.id}'`);
    }

    this.migrations.push(migration);
  }

  /**
   * Run all registered migrations across all guilds.
   * Migrations run sequentially (may depend on each other).
   * Guilds within each migration run in parallel with concurrency limit.
   */
  async runAll(guildIds: string[]): Promise<MigrationReport> {
    const startTime = Date.now();
    const results: MigrationReportEntry[] = [];

    if (this.dryRun) {
      enhancedLogger.info('Legacy migration dry-run mode enabled', LogCategory.DATABASE);
    }

    for (const migration of this.migrations) {
      const entry: MigrationReportEntry = {
        migrationId: migration.id,
        guildsProcessed: 0,
        guildsSkipped: 0,
        guildsFailed: 0,
        totalChanges: 0,
        failures: [],
      };

      await asyncPool(this.concurrency, guildIds, async (guildId: string) => {
        try {
          const needsMigration = await migration.detect(guildId);

          if (!needsMigration) {
            entry.guildsSkipped++;
            return;
          }

          if (this.dryRun) {
            enhancedLogger.info(`[DRY RUN] Would migrate guild ${guildId} for '${migration.id}'`, LogCategory.DATABASE);
            entry.guildsProcessed++;
            return;
          }

          const result = await migration.migrate(guildId);

          if (result.success) {
            entry.guildsProcessed++;
            entry.totalChanges += result.changes;
            if (result.details) {
              enhancedLogger.info(
                `Migration '${migration.id}' for guild ${guildId}: ${result.details}`,
                LogCategory.DATABASE,
              );
            }
          } else {
            entry.guildsFailed++;
            entry.failures.push({
              guildId,
              error: result.details || 'Migration returned success=false',
            });
          }
        } catch (error) {
          entry.guildsFailed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          entry.failures.push({ guildId, error: errorMessage });
          enhancedLogger.warn(
            `Migration '${migration.id}' failed for guild ${guildId}: ${errorMessage}`,
            LogCategory.DATABASE,
          );
        }
      });

      // Log summary for this migration if anything happened
      if (entry.guildsProcessed > 0 || entry.guildsFailed > 0) {
        enhancedLogger.info(
          `Migration '${migration.id}': processed=${entry.guildsProcessed}, skipped=${entry.guildsSkipped}, failed=${entry.guildsFailed}, changes=${entry.totalChanges}`,
          LogCategory.DATABASE,
        );
      }

      results.push(entry);
    }

    return {
      totalGuilds: guildIds.length,
      totalMigrations: this.migrations.length,
      results,
      durationMs: Date.now() - startTime,
    };
  }
}
