/**
 * Import Manager
 *
 * Orchestrates bot data imports. Manages concurrency (one import per guild),
 * tracks running imports, persists ImportLog records, and enforces cooldowns.
 */

import { AppDataSource } from '../../typeorm';
import { ImportLog } from '../../typeorm/entities/import/ImportLog';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { CsvImporter } from './csvImporter';
import { Mee6Importer } from './mee6Importer';
import type { BotImporter, ImportOptions, ImportResult } from './types';

/** Cooldown: 1 import per guild per hour */
const IMPORT_COOLDOWN_MS = 60 * 60 * 1000;

export class ImportManager {
  private importers: Map<string, BotImporter> = new Map();
  private runningImports: Map<string, ImportLog> = new Map();

  constructor() {
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
   * Check cooldown: returns null if allowed, or a Date of when the next import is available
   */
  async checkCooldown(guildId: string): Promise<Date | null> {
    const repo = AppDataSource.getRepository(ImportLog);
    const lastImport = await repo.findOne({
      where: { guildId, status: 'completed' },
      order: { completedAt: 'DESC' },
    });

    if (!lastImport?.completedAt) return null;

    const nextAvailable = new Date(lastImport.completedAt.getTime() + IMPORT_COOLDOWN_MS);
    if (nextAvailable > new Date()) {
      return nextAvailable;
    }

    return null;
  }

  /**
   * Start an import. Creates an ImportLog, runs the importer, and updates the log on completion.
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

    // Create ImportLog record
    const repo = AppDataSource.getRepository(ImportLog);
    const importLog = repo.create({
      guildId,
      source,
      dataType,
      triggeredBy,
      status: 'running',
    });
    await repo.save(importLog);

    this.runningImports.set(guildId, importLog);

    try {
      const result = await importer.import(guildId, dataType, options);

      // Update log with results
      importLog.importedCount = result.imported;
      importLog.skippedCount = result.skipped;
      importLog.failedCount = result.failed;
      importLog.errors = result.errors.length > 0 ? result.errors : null;
      importLog.completedAt = new Date();
      importLog.durationMs = result.durationMs;
      importLog.status = result.success ? 'completed' : 'failed';
      await repo.save(importLog);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      enhancedLogger.error(
        `Import failed for guild ${guildId}`,
        error instanceof Error ? error : undefined,
        LogCategory.COMMAND_EXECUTION,
        { guildId, source, dataType },
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
      this.runningImports.delete(guildId);
    }
  }

  /**
   * Cancel a running import for a guild
   */
  async cancelImport(guildId: string): Promise<boolean> {
    const importLog = this.runningImports.get(guildId);
    if (!importLog) return false;

    const repo = AppDataSource.getRepository(ImportLog);
    importLog.status = 'cancelled';
    importLog.completedAt = new Date();
    importLog.durationMs = Date.now() - importLog.startedAt.getTime();
    await repo.save(importLog);

    this.runningImports.delete(guildId);
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
