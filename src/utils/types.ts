/**
 * Types Module
 *
 * Shared TypeScript type definitions used across the bot.
 */

// ============================================================================
// Status Types
// ============================================================================

/** Possible states for a support ticket */
export type TicketStatus = 'created' | 'opened' | 'closed' | 'adminOnly' | 'error';

/** Possible states for a staff application */
export type ApplicationStatus = 'created' | 'opened' | 'closed' | 'accepted' | 'rejected' | 'error';

/** Types of saved roles that can be managed */
export type SavedRoleTypes = 'staff' | 'admin';

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Options for downloading and archiving Discord data
 */
export interface DownloadOptions {
  /** Output directory for downloaded files */
  outputDir: string;
  /** Skip files that already exist */
  skipExisting?: boolean;
  /** Number of items to download at once */
  batchSize?: number;
  /** Max retry attempts for failed downloads */
  maxRetries?: number;
}
