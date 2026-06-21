/**
 * Shared Application Close Workflow
 *
 * Extracts the common archive logic used by both the Discord button event
 * (events/application/close.ts) and the internal API handler
 * (utils/api/handlers/applicationHandlers.ts).
 *
 * Handles: transcript fetch → forum archive post → channel delete.
 * Callers are responsible for: finding the application, marking it closed,
 * and any audit logging.
 */

import type { Client, ForumChannel, ForumThreadChannel, GuildTextBasedChannel } from 'discord.js';
import type { Application } from '../../typeorm/entities/application/Application';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { lazyRepo } from '../database/lazyRepo';
import { verifiedChannelDelete } from '../discord/verifiedDelete';
import { fetchMessagesAsTranscript } from '../fetchAllMessages';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { buildTranscript, type TicketMetadata, type TranscriptMessage } from '../ticket/transcriptBuilder';
import { postTranscriptToThread } from '../ticket/transcriptPoster';

const archivedAppRepo = lazyRepo(ArchivedApplication);

export interface ArchiveApplicationResult {
  success: boolean;
  archived: boolean;
  transcriptFailed?: boolean;
}

/**
 * Injectable seam dependencies for {@link archiveAndCloseApplication}.
 *
 * Mirrors the ticket close workflow's pattern. Production callers omit this;
 * tests pass fakes directly instead of `mock.module()` (which bun applies
 * inconsistently across a full-suite run on Linux — see the ticket workflow's
 * flaky-CI note, 2026-05-30). Direct injection is deterministic on every platform.
 */
export interface CloseApplicationWorkflowDeps {
  fetchMessagesAsTranscript: typeof fetchMessagesAsTranscript;
  verifiedChannelDelete: typeof verifiedChannelDelete;
  archivedAppRepo: typeof archivedAppRepo;
}

const defaultDeps: CloseApplicationWorkflowDeps = {
  fetchMessagesAsTranscript,
  verifiedChannelDelete,
  archivedAppRepo,
};

/**
 * Archive an application to the forum channel and clean up.
 *
 * Does NOT mark the application as closed — callers must do that before calling
 * to prevent duplicate-close races (see existing `applicationCloseEvent` and
 * the API archive route).
 */
export async function archiveAndCloseApplication(
  client: Client,
  application: Application,
  guildId: string,
  channel: GuildTextBasedChannel,
  archiveForumChannelId: string,
  deps: CloseApplicationWorkflowDeps = defaultDeps,
): Promise<ArchiveApplicationResult> {
  const channelId = application.channelId || channel.id;

  let transcriptMessages: TranscriptMessage[];
  try {
    transcriptMessages = await deps.fetchMessagesAsTranscript(channel, client.user?.id ?? '');
  } catch (error) {
    enhancedLogger.error('Failed to fetch application messages for transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return { success: false, archived: false, transcriptFailed: true };
  }

  const creatorUser = await client.users.fetch(application.createdBy).catch(() => null);
  const threadName = creatorUser?.username || 'Unknown';
  const metadata: TicketMetadata = {
    title: `Application: ${threadName}`,
    type: 'Application',
    createdByUsername: threadName,
    openedAt: 'createdAt' in channel && channel.createdAt instanceof Date ? channel.createdAt : new Date(),
    closedAt: new Date(),
    assignedToUsername: null,
  };

  const transcript = buildTranscript(transcriptMessages, metadata);

  let archived = true;
  try {
    const forumChannel = (await client.channels.fetch(archiveForumChannelId)) as ForumChannel;
    const existingArchive = await deps.archivedAppRepo.findOneBy({
      createdBy: application.createdBy,
      guildId,
    });

    if (!existingArchive) {
      const newPost = await forumChannel.threads.create({
        name: threadName,
        // allowedMentions parse:[] — historical transcript, never ping anyone.
        message: { content: transcript.header, allowedMentions: { parse: [] } },
      });

      // Persist the archive row BEFORE posting chunks: a chunk failure then
      // leaves the row pointing at this thread, so the retry appends instead of
      // orphaning it and creating a duplicate.
      await deps.archivedAppRepo.save(
        deps.archivedAppRepo.create({
          guildId,
          createdBy: application.createdBy,
          messageId: newPost.id,
        }),
      );

      await postTranscriptToThread(newPost, transcript.chunks, { guildId, channelId, label: 'Application transcript' });
    } else if (existingArchive.messageId) {
      // Re-close: reuse the archive thread, but it may have been deleted out
      // from under us. force:true bypasses the cache; catch ONLY 10003 (Unknown
      // Channel) and recreate so the transcript is never lost — let other errors
      // bubble to the outer catch (marks archived:false, preserves the channel).
      const post = (await forumChannel.threads
        .fetch(existingArchive.messageId, { force: true })
        .catch((err: unknown) => {
          if ((err as { code?: number })?.code === 10003) return null;
          throw err;
        })) as ForumThreadChannel | null;

      if (!post) {
        const newPost = await forumChannel.threads.create({
          name: threadName,
          message: { content: transcript.header, allowedMentions: { parse: [] } },
        });
        // Repoint + persist BEFORE chunks so a chunk failure can't orphan it.
        existingArchive.messageId = newPost.id;
        await deps.archivedAppRepo.save(existingArchive);
        await postTranscriptToThread(newPost, transcript.chunks, {
          guildId,
          channelId,
          label: 'Application transcript',
        });
      } else {
        const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
        await post.send({
          content: separator + transcript.header,
          allowedMentions: { parse: [] },
        });
        await postTranscriptToThread(post, transcript.chunks, { guildId, channelId, label: 'Application transcript' });
      }
    }
  } catch (error) {
    enhancedLogger.error('Failed to post application transcript to forum', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    archived = false;
  }

  if (!archived) {
    // Archive failed. DO NOT delete the source channel — preserve it so the
    // conversation isn't lost and the close can be retried. The caller reverts
    // the application status so the retry isn't blocked by the dup-close guard.
    enhancedLogger.warn('Application archive failed — preserving channel for retry', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return { success: false, archived: false };
  }

  enhancedLogger.info('Application transcript archived successfully', LogCategory.SYSTEM, {
    guildId,
    channelId,
    messageCount: transcript.messageCount,
    attachmentCount: transcript.attachmentCount,
  });

  const deleteResult = await deps.verifiedChannelDelete(channel, {
    guildId,
    label: 'application channel',
  });
  if (!deleteResult.success) {
    enhancedLogger.error(
      `Application channel persisted after delete attempt — possible bug. Channel: ${channelId}`,
      undefined,
      LogCategory.ERROR,
      {
        guildId,
        channelId,
        error: deleteResult.error,
      },
    );
  }

  return { success: true, archived: true };
}
