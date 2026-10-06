/**
 * Bot Data Import System — Types and Interfaces
 *
 * Defines the contracts for all bot importers (MEE6, Arcane, CSV, etc.)
 */

export interface ImportOptions {
  overwrite?: boolean;
  dryRun?: boolean;
  /** File content for file-based importers (CSV). Passed per call: importers are shared by every guild. */
  content?: string;
  /** Set by importManager: true once /import cancel was used. Long-running importers should stop. */
  isCancelled?: () => boolean;
  onProgress?: (imported: number, total: number) => void;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
  durationMs: number;
  /** Parsed records for this call only; importManager hands them to the XP writer. */
  records?: RawXpRecord[];
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
