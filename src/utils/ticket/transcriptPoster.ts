/**
 * Posts a built transcript's chunks into a forum archive thread.
 *
 * Shared spine of the ticket and application close workflows (near-mirror
 * archive paths). Kept separate from the pure `transcriptBuilder` so that
 * module stays Discord-client-free. Never pings (historical content),
 * attributes a failed send to its chunk index so a partial-archive failure is
 * diagnosable, and rethrows so the caller marks the archive failed.
 */
import type { ForumThreadChannel } from 'discord.js';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

export interface TranscriptPostContext {
  guildId: string;
  channelId: string;
  /** Log-label prefix for chunk-failure errors. Defaults to 'Transcript'. */
  label?: string;
}

export async function postTranscriptToThread(
  thread: ForumThreadChannel,
  chunks: string[],
  ctx: TranscriptPostContext,
): Promise<void> {
  const label = ctx.label ?? 'Transcript';
  for (let i = 0; i < chunks.length; i++) {
    try {
      await thread.send({ content: chunks[i], allowedMentions: { parse: [] } });
    } catch (error) {
      enhancedLogger.error(
        `${label} chunk ${i + 1}/${chunks.length} failed to post`,
        error as Error,
        LogCategory.SYSTEM,
        { guildId: ctx.guildId, channelId: ctx.channelId },
      );
      throw error;
    }
  }
}
