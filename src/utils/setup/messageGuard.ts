import type { Guild, GuildBasedChannel } from 'discord.js';
import { verifiedMessageDeleteById } from '../discord/verifiedDelete';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

/**
 * Safely fetch a guild channel, returning null if it doesn't exist or can't be accessed.
 */
export async function safeChannelFetch(guild: Guild, channelId: string): Promise<GuildBasedChannel | null> {
  try {
    return await guild.channels.fetch(channelId);
  } catch {
    enhancedLogger.debug('Channel not found or inaccessible', LogCategory.SYSTEM, {
      guildId: guild.id,
      channelId,
    });
    return null;
  }
}

/**
 * Clean up an old bot message by channel ID and message ID.
 * Returns true if the message was deleted or was already gone (goal = "message no longer exists").
 * Returns false only on unexpected errors.
 */
export async function cleanupOldMessage(guild: Guild, channelId: string, messageId: string): Promise<boolean> {
  if (!channelId || !messageId) return true;

  const channel = await safeChannelFetch(guild, channelId);
  if (!channel?.isTextBased()) return true; // Channel gone = message gone

  // Shared fetch → delete → already-gone-counts-as-success flow (this used to
  // reimplement verifiedMessageDeleteById by hand).
  const result = await verifiedMessageDeleteById(channel, messageId, {
    guildId: guild.id,
    label: 'old bot message',
  });
  return result.success;
}
