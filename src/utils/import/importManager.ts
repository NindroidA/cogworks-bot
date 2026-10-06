/**
 * Import Manager
 *
 * Orchestrates bot data imports. Manages concurrency (one import per guild),
 * tracks running imports, persists ImportLog records, and enforces cooldowns.
 */

import { lang } from '../../lang';
import { AppDataSource } from '../../typeorm';
import { ImportLog } from '../../typeorm/entities/import/ImportLog';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { CsvImporter } from './csvImporter';
import { Mee6Importer } from './mee6Importer';
import type { BotImporter, ImportOptions, ImportResult } from './types';
import { writeImportedXp } from './xpWriter';

/** Cooldown: 1 import per guild per hour */
const IMPORT_COOLDOWN_MS = 60 * 60 * 1000;
/** Dry runs per guild: 1 per 2 minutes, so a MEE6 dry run can't hammer its API. */
const DRY_RUN_COOLDOWN_MS = 2 * 60 * 1000;

export class ImportManager {
  private importers: Map<string, BotImporter> = new Map();
  private runningImports: Map<string, ImportLog> = new Map();

  /** `writeXp` is injectable so tests can run an import without a database. */
  constructor(private readonly writeXp: typeof writeImportedXp = writeImportedXp) {
    // Register built-in importers
    const mee6 = new Mee6Importer();
    const csv = new CsvImporter();
    this.importers.set(mee6.name, mee6);
    this.importers.set(csv.name, csv);
  }

  /**
   * Register an additional importer
   */
  registerImporter(importer: BotImporter): void {
    this.importers.set(importer.name, importer);
  }

  /**
   * Get an importer by name
   */
  getImporter(name: string): BotImporter | undefined {
    return this.importers.get(name);
  }

  /**
   * Check whether an import is currently running for a guild
   */
  isRunning(guildId: string): boolean {
    return this.runningImports.has(guildId);
  }

  /**
   * Get the running import log for a guild (if any)
   */
  getRunningImport(guildId: string): ImportLog | undefined {
    return this.runningImports.get(guildId);
  }

  /**
   * Check cooldown: returns null if allowed, or a Date of when the next import is available.
   * A completed import blocks every import for an hour; a dry run blocks only the next dry run.
   */
  async checkCooldown(guildId: string, dryRun = false): Promise<Date | null> {
    const repo = AppDataSource.getRepository(ImportLog);
    const rules: Array<[status: string, ms: number]> = [['completed', IMPORT_COOLDOWN_MS]];
    if (dryRun) rules.push(['dry_run', DRY_RUN_COOLDOWN_MS]);

    for (const [status, ms] of rules) {
      const last = await repo.findOne({ where: { guildId, status }, order: { completedAt: 'DESC' } });
      if (!last?.completedAt) continue;
      const nextAvailable = new Date(last.completedAt.getTime() + ms);
      if (nextAvailable > new Date()) return nextAvailable;
    }

    return null;
  }

  /**
   * Start an import. Creates an ImportLog, runs the importer, writes the XP and
   * updates the log. Only an import that wrote rows is logged as 'completed'
   * (the status the 1-hour cooldown counts). Otherwise the log is 'dry_run',
   * 'no_changes', 'failed' (the write rolled back) or 'cancelled'.
   */
  async startImport(
    guildId: string,
    source: string,
    dataType: string,
    triggeredBy: string,
    options?: ImportOptions,
  ): Promise<ImportResult> {
    const importer = this.importers.get(source);
    if (!importer) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [`Unknown import source: ${source}`],
        durationMs: 0,
      };
    }

    if (!importer.supportedData.includes(dataType)) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [`Source '${source}' does not support data type '${dataType}'`],
        durationMs: 0,
      };
    }

    if (this.runningImports.has(guildId)) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [lang.import.commands.importAlreadyRunning],
        durationMs: 0,
      };
    }

    // Create ImportLog record. Claim the guild's slot before the first await so
    // two quick submits can't both start.
    const repo = AppDataSource.getRepository(ImportLog);
    const importLog = repo.create({
      guildId,
      source,
      dataType,
      triggeredBy,
      status: 'running',
      startedAt: new Date(),
    });
    this.runningImports.set(guildId, importLog);

    // /import cancel saves the log as 'cancelled'; the importer and the writer stop at their next check.
    const isCancelled = () => importLog.status === 'cancelled';
    const dryRun = options?.dryRun ?? false;

    try {
      await repo.save(importLog);
      const { records = [], ...result } = await importer.import(guildId, dataType, { ...options, isCancelled });

      if (isCancelled()) {
        await repo.save(importLog); // cancelImport skips its save if it ran before the first one finished
        return { ...result, success: false, imported: 0, errors: [lang.import.commands.importCancelled] };
      }

      if (result.success) {
        const writeOptions = { overwrite: options?.overwrite ?? false, dryRun, isCancelled };
        const written = await this.writeXp(guildId, records, writeOptions);
        result.imported = written.written;
        result.skipped += written.skippedExisting;
        result.durationMs = Date.now() - importLog.startedAt.getTime();
      }

      // Update log with results
      importLog.importedCount = result.imported;
      importLog.skippedCount = result.skipped;
      importLog.failedCount = result.failed;
      importLog.errors = result.errors.length > 0 ? result.errors : null;
      importLog.completedAt = new Date();
      importLog.durationMs = result.durationMs;
      // A cancel that lands while the transaction commits is too late to undo: the log keeps
      // 'cancelled' (with the written counts) rather than being overwritten.
      if (!isCancelled()) {
        importLog.status = !result.success
          ? 'failed'
          : dryRun
            ? 'dry_run'
            : result.imported > 0
              ? 'completed'
              : 'no_changes';
      }
      await repo.save(importLog);

      return result;
    } catch (error) {
      if (isCancelled()) {
        // The writer rolled back; the log already says 'cancelled'.
        await repo.save(importLog);
        return {
          success: false,
          imported: 0,
          skipped: 0,
          failed: 0,
          errors: [lang.import.commands.importCancelled],
          durationMs: Date.now() - importLog.startedAt.getTime(),
        };
      }
      const message = error instanceof Error ? error.message : 'Unknown error';

      enhancedLogger.error(
        `Import failed for guild ${guildId}`,
        error instanceof Error ? error : undefined,
        LogCategory.COMMAND_EXECUTION,
        {
          guildId,
          source,
          dataType,
        },
      );

      importLog.status = 'failed';
      importLog.errors = [message];
      importLog.completedAt = new Date();
      importLog.durationMs = Date.now() - importLog.startedAt.getTime();
      await repo.save(importLog);

      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [message],
        durationMs: importLog.durationMs,
      };
    } finally {
      // Freed only here, also after a cancel, so a new import can't start while this one still runs.
      this.runningImports.delete(guildId);
    }
  }

  /**
   * Cancel a running import for a guild. The import stops (and rolls back any
   * write in progress) at its next check; startImport frees the guild's slot.
   */
  async cancelImport(guildId: string): Promise<boolean> {
    const importLog = this.runningImports.get(guildId);
    if (!importLog) return false;
    if (importLog.status === 'cancelled') return true;

    importLog.status = 'cancelled';
    importLog.completedAt = new Date();
    importLog.durationMs = Date.now() - importLog.startedAt.getTime();
    // Before startImport's first save has inserted the row, saving here would insert a second one;
    // startImport saves the cancelled log itself when it stops.
    if (importLog.id !== undefined) await AppDataSource.getRepository(ImportLog).save(importLog);
    return true;
  }

  /**
   * Get import history for a guild
   */
  async getHistory(guildId: string, limit = 10): Promise<ImportLog[]> {
    const repo = AppDataSource.getRepository(ImportLog);
    return repo.find({
      where: { guildId },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }
}

/** Singleton import manager instance */
export const importManager = new ImportManager();
