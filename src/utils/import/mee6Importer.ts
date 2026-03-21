/**
 * MEE6 Bot Data Importer
 *
 * Fetches XP/leveling data from the public MEE6 leaderboard API.
 * Rate limited to 1 request per 2 seconds to avoid IP bans.
 */

import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { BotImporter, ImportOptions, ImportResult, RawXpRecord } from './types';

const MEE6_API_BASE = 'https://mee6.xyz/api/plugins/levels/leaderboard';
const REQUEST_DELAY_MS = 2000;
const PAGE_LIMIT = 1000;

interface Mee6Player {
  id: string;
  username: string;
  discriminator: string;
  xp: number;
  level: number;
  message_count: number;
}

interface Mee6LeaderboardResponse {
  players: Mee6Player[];
  page: number;
}

/**
 * Delay execution for a given number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Mee6Importer implements BotImporter {
  name = 'mee6';
  displayName = 'MEE6';
  supportedData = ['xp'];

  /**
   * Collected records from the last import (available for downstream consumption)
   */
  public lastImportRecords: RawXpRecord[] = [];

  async import(guildId: string, dataType: string, options?: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let imported = 0;
    const skipped = 0;
    let failed = 0;

    if (dataType !== 'xp') {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [`Unsupported data type: ${dataType}. MEE6 importer only supports 'xp'.`],
        durationMs: Date.now() - startTime,
      };
    }

    const records: RawXpRecord[] = [];
    let page = 0;
    let hasMore = true;

    enhancedLogger.info(
      `Starting MEE6 XP import for guild ${guildId}`,
      LogCategory.COMMAND_EXECUTION,
      { dryRun: options?.dryRun, overwrite: options?.overwrite },
    );

    while (hasMore) {
      try {
        const url = `${MEE6_API_BASE}/${guildId}?page=${page}&limit=${PAGE_LIMIT}`;
        const response = await fetch(url);

        if (response.status === 403 || response.status === 401) {
          errors.push('MEE6 leaderboard is not public for this server.');
          return {
            success: false,
            imported,
            skipped,
            failed,
            errors,
            durationMs: Date.now() - startTime,
          };
        }

        if (response.status === 404) {
          errors.push('MEE6 leaderboard not found for this server. Is MEE6 installed?');
          return {
            success: false,
            imported,
            skipped,
            failed,
            errors,
            durationMs: Date.now() - startTime,
          };
        }

        if (response.status === 429) {
          errors.push('Rate limited by MEE6 API. Please try again later.');
          return {
            success: false,
            imported,
            skipped,
            failed,
            errors,
            durationMs: Date.now() - startTime,
          };
        }

        if (!response.ok) {
          errors.push(`MEE6 API returned status ${response.status}`);
          return {
            success: false,
            imported,
            skipped,
            failed,
            errors,
            durationMs: Date.now() - startTime,
          };
        }

        const data = (await response.json()) as Mee6LeaderboardResponse;

        if (!data.players || data.players.length === 0) {
          hasMore = false;
          break;
        }

        for (const player of data.players) {
          if (!player.id || typeof player.xp !== 'number') {
            failed++;
            errors.push(`Invalid player data on page ${page}: missing id or xp`);
            continue;
          }

          records.push({
            userId: player.id,
            xp: player.xp,
            level: player.level ?? 0,
            messageCount: player.message_count ?? 0,
            username: player.username,
          });
          imported++;
        }

        // Report progress
        if (options?.onProgress) {
          options.onProgress(imported, imported);
        }

        enhancedLogger.info(
          `MEE6 import page ${page}: fetched ${data.players.length} players (total: ${imported})`,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );

        // If we got fewer than the limit, we've reached the end
        if (data.players.length < PAGE_LIMIT) {
          hasMore = false;
        } else {
          page++;
          // Rate limit: wait between requests
          await delay(REQUEST_DELAY_MS);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Error fetching page ${page}: ${message}`);
        failed++;

        enhancedLogger.error(
          `MEE6 import error on page ${page}`,
          error instanceof Error ? error : undefined,
          LogCategory.COMMAND_EXECUTION,
          { guildId, page },
        );

        // Stop on network errors
        hasMore = false;
      }
    }

    this.lastImportRecords = records;

    const durationMs = Date.now() - startTime;

    enhancedLogger.info(
      `MEE6 import ${options?.dryRun ? '(dry run) ' : ''}complete for guild ${guildId}: ${imported} imported, ${skipped} skipped, ${failed} failed (${durationMs}ms)`,
      LogCategory.COMMAND_EXECUTION,
    );

    return {
      success: errors.length === 0 || imported > 0,
      imported,
      skipped,
      failed,
      errors,
      durationMs,
    };
  }
}
