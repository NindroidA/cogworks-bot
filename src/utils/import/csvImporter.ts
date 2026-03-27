/**
 * CSV Bot Data Importer
 *
 * Parses CSV content with format: userId,xp,level,messages
 * Validates snowflake IDs and numeric values.
 */

import { isValidSnowflake } from '../api/helpers';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { BotImporter, ImportOptions, ImportResult, RawXpRecord } from './types';

const EXPECTED_HEADER = 'userId,xp,level,messages';
const MIN_COLUMNS = 4;

export class CsvImporter implements BotImporter {
  name = 'csv';
  displayName = 'CSV';
  supportedData = ['xp'];

  /**
   * Collected records from the last import (available for downstream consumption)
   */
  public lastImportRecords: RawXpRecord[] = [];

  /**
   * The CSV content to parse. Set this before calling import().
   */
  public csvContent: string = '';

  async import(guildId: string, dataType: string, options?: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    if (dataType !== 'xp') {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [`Unsupported data type: ${dataType}. CSV importer only supports 'xp'.`],
        durationMs: Date.now() - startTime,
      };
    }

    if (!this.csvContent || this.csvContent.trim().length === 0) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: ['CSV content is empty.'],
        durationMs: Date.now() - startTime,
      };
    }

    const lines = this.csvContent.trim().split('\n');
    if (lines.length === 0) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: ['CSV content is empty.'],
        durationMs: Date.now() - startTime,
      };
    }

    // Check header (case-insensitive)
    const header = lines[0].trim().toLowerCase();
    if (header === EXPECTED_HEADER.toLowerCase()) {
      // Skip header row
      lines.shift();
    }

    const records: RawXpRecord[] = [];
    const seenUserIds = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;

      const lineNumber = i + 1;
      const columns = line.split(',').map(c => c.trim());

      if (columns.length < MIN_COLUMNS) {
        failed++;
        errors.push(`Row ${lineNumber}: Expected ${MIN_COLUMNS} columns, got ${columns.length}`);
        continue;
      }

      const [userId, xpStr, levelStr, messagesStr] = columns;

      // Validate snowflake ID
      if (!isValidSnowflake(userId)) {
        failed++;
        errors.push(`Row ${lineNumber}: Invalid user ID '${userId}'`);
        continue;
      }

      // Check for duplicates
      if (seenUserIds.has(userId)) {
        skipped++;
        errors.push(`Row ${lineNumber}: Duplicate user ID '${userId}', skipping`);
        continue;
      }

      // Validate numeric fields
      const xp = Number(xpStr);
      const level = Number(levelStr);
      const messageCount = Number(messagesStr);

      if (Number.isNaN(xp) || xp < 0) {
        failed++;
        errors.push(`Row ${lineNumber}: Invalid XP value '${xpStr}'`);
        continue;
      }

      if (Number.isNaN(level) || level < 0) {
        failed++;
        errors.push(`Row ${lineNumber}: Invalid level value '${levelStr}'`);
        continue;
      }

      if (Number.isNaN(messageCount) || messageCount < 0) {
        failed++;
        errors.push(`Row ${lineNumber}: Invalid messages value '${messagesStr}'`);
        continue;
      }

      seenUserIds.add(userId);
      records.push({ userId, xp, level, messageCount });
      imported++;

      // Report progress
      if (options?.onProgress && imported % 100 === 0) {
        options.onProgress(imported, lines.length);
      }
    }

    this.lastImportRecords = records;

    const durationMs = Date.now() - startTime;

    enhancedLogger.info(
      `CSV import ${options?.dryRun ? '(dry run) ' : ''}complete for guild ${guildId}: ${imported} imported, ${skipped} skipped, ${failed} failed (${durationMs}ms)`,
      LogCategory.COMMAND_EXECUTION,
    );

    return {
      success: imported > 0 || (imported === 0 && failed === 0),
      imported,
      skipped,
      failed,
      errors,
      durationMs,
    };
  }
}
