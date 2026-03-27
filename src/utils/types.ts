/**
 * Types Module
 *
 * Shared TypeScript type definitions used across the bot.
 */

import type { CacheType, ChatInputCommandInteraction } from 'discord.js';

/**
 * Extracts and narrows `interaction.guildId` to a non-null string.
 * Throws if the interaction was invoked outside a guild (DM context).
 *
 * Use this instead of `interaction.guildId!` to get type-safe narrowing:
 * ```ts
 * const guildId = getGuildId(interaction);
 * // guildId is `string`, not `string | null`
 * ```
 */
export function getGuildId(interaction: ChatInputCommandInteraction<CacheType>): string {
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error('Command must be used in a guild');
  }
  return guildId;
}

/** Possible states for a support ticket (includes workflow custom statuses via string) */
export type TicketStatus = 'created' | 'opened' | 'closed' | 'adminOnly' | 'error' | (string & {});

/** Possible states for a staff application (includes workflow custom statuses via string) */
export type ApplicationStatus = 'created' | 'opened' | 'closed' | 'accepted' | 'rejected' | 'error' | (string & {});

/** Types of saved roles that can be managed */
export type SavedRoleTypes = 'staff' | 'admin';

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
