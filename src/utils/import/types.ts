/**
 * Bot Data Import System — Types and Interfaces
 *
 * Defines the contracts for all bot importers (MEE6, Arcane, CSV, etc.)
 */

export interface ImportOptions {
  overwrite?: boolean;
  dryRun?: boolean;
  onProgress?: (imported: number, total: number) => void;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

export interface BotImporter {
  name: string;
  displayName: string;
  supportedData: string[];
  import(guildId: string, dataType: string, options?: ImportOptions): Promise<ImportResult>;
}

/**
 * Raw XP record extracted from an external bot's data
 * Used as intermediate format before writing to the XP system
 */
export interface RawXpRecord {
  userId: string;
  xp: number;
  level: number;
  messageCount: number;
  username?: string;
}
