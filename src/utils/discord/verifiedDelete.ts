/**
 * Verified Discord Deletion Utilities
 *
 * Wrappers for Discord delete operations that verify the object was actually
 * removed before reporting success. Returns structured results so callers
 * can decide how to handle partial failures.
 *
 * Deletion order: Discord object first, THEN database record.
 * This prevents orphaned Discord objects when DB succeeds but Discord fails.
 */

import type { GuildBasedChannel, Message, ThreadChannel } from 'discord.js';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

/** Discord API error codes for "already gone" — not real failures */
const ALREADY_GONE_CODES = [
  10003, // Unknown Channel
  10008, // Unknown Message
  10004, // Unknown Guild
];

export interface DeleteResult {
  /** Whether the Discord object was successfully deleted (or was already gone) */
  success: boolean;
  /** Whether the object was already gone before we tried to delete it */
  alreadyGone: boolean;
  /** Error message if deletion failed (not already-gone) */
  error?: string;
}

/**
 * Delete a Discord message with verification.
 * Returns success if deleted OR if it was already gone (10008).
 */
export async function verifiedMessageDelete(
  message: Message,
  context: { guildId: string; label?: string },
): Promise<DeleteResult> {
  const label = context.label || 'message';
  try {
    await message.delete();
    return { success: true, alreadyGone: false };
  } catch (error: any) {
    const code = error?.code ?? error?.rawError?.code;
    if (ALREADY_GONE_CODES.includes(code)) {
      return { success: true, alreadyGone: true };
    }
    enhancedLogger.error(
      `Failed to delete ${label} (${message.id})`,
      error instanceof Error ? error : undefined,
      LogCategory.ERROR,
      {
        guildId: context.guildId,
        messageId: message.id,
      },
    );
    return {
      success: false,
      alreadyGone: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Delete a Discord channel with verification.
 * Returns success if deleted OR if it was already gone (10003).
 */
export async function verifiedChannelDelete(
  channel: GuildBasedChannel,
  context: { guildId: string; label?: string },
): Promise<DeleteResult> {
  const label = context.label || 'channel';
  try {
    await channel.delete();
    return { success: true, alreadyGone: false };
  } catch (error: any) {
    const code = error?.code ?? error?.rawError?.code;
    if (ALREADY_GONE_CODES.includes(code)) {
      return { success: true, alreadyGone: true };
    }
    enhancedLogger.error(
      `Failed to delete ${label} (${channel.id})`,
      error instanceof Error ? error : undefined,
      LogCategory.ERROR,
      {
        guildId: context.guildId,
        channelId: channel.id,
      },
    );
    return {
      success: false,
      alreadyGone: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Delete a Discord thread with verification.
 * Returns success if deleted OR if it was already gone (10003).
 */
export async function verifiedThreadDelete(
  thread: ThreadChannel,
  context: { guildId: string; label?: string },
): Promise<DeleteResult> {
  const label = context.label || 'thread';
  try {
    await thread.delete();
    return { success: true, alreadyGone: false };
  } catch (error: any) {
    const code = error?.code ?? error?.rawError?.code;
    if (ALREADY_GONE_CODES.includes(code)) {
      return { success: true, alreadyGone: true };
    }
    enhancedLogger.error(
      `Failed to delete ${label} (${thread.id})`,
      error instanceof Error ? error : undefined,
      LogCategory.ERROR,
      {
        guildId: context.guildId,
        threadId: thread.id,
      },
    );
    return {
      success: false,
      alreadyGone: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Delete a Discord message by ID from a channel, handling common failure cases.
 * Fetches the message first, then deletes with verification.
 * Returns success if deleted, already gone, or channel/message not found.
 */
export async function verifiedMessageDeleteById(
  channel: GuildBasedChannel & {
    messages: { fetch: (id: string) => Promise<Message> };
  },
  messageId: string,
  context: { guildId: string; label?: string },
): Promise<DeleteResult> {
  try {
    const message = await channel.messages.fetch(messageId);
    return await verifiedMessageDelete(message, context);
  } catch (error: any) {
    const code = error?.code ?? error?.rawError?.code;
    if (ALREADY_GONE_CODES.includes(code)) {
      return { success: true, alreadyGone: true };
    }
    enhancedLogger.error(
      `Failed to fetch/delete ${context.label || 'message'} (${messageId})`,
      error instanceof Error ? error : undefined,
      LogCategory.ERROR,
      { guildId: context.guildId, messageId },
    );
    return {
      success: false,
      alreadyGone: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * User-facing bug report message shown when an unexpected error occurs.
 * Only use this for REAL bugs — not expected states like "no data found".
 */
export const BUG_REPORT_MESSAGE =
  '\n\n-# If this issue persists, please report it on our [support server](https://discord.gg/cogworks).';

/**
 * Build a user-facing error message with optional bug report link.
 * @param userMessage - What the user sees (e.g., "Failed to delete the ticket channel")
 * @param includeBugReport - Whether to append the bug report link (default: true)
 */
export function buildErrorMessage(userMessage: string, includeBugReport = true): string {
  return includeBugReport ? `${userMessage}${BUG_REPORT_MESSAGE}` : userMessage;
}
