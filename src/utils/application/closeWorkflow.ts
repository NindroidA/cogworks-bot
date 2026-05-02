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

const archivedAppRepo = lazyRepo(ArchivedApplication);

export interface ArchiveApplicationResult {
  success: boolean;
  archived: boolean;
  transcriptFailed?: boolean;
}

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
): Promise<ArchiveApplicationResult> {
  const channelId = application.channelId || channel.id;

  let transcriptMessages: TranscriptMessage[];
  try {
    transcriptMessages = await fetchMessagesAsTranscript(channel, client.user?.id ?? '');
  } catch (error) {
    enhancedLogger.error('Failed to fetch application messages for transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return { success: false, archived: false, transcriptFailed: true };
  }

  const creatorUser = await client.users.fetch(application.createdBy).catch(() => null);
  const metadata: TicketMetadata = {
    title: `Application: ${creatorUser?.username || 'Unknown'}`,
    type: 'Application',
    createdByUsername: creatorUser?.username || 'Unknown',
    openedAt: 'createdAt' in channel && channel.createdAt instanceof Date ? channel.createdAt : new Date(),
    closedAt: new Date(),
    assignedToUsername: null,
  };

  const transcript = buildTranscript(transcriptMessages, metadata);

  let archived = true;
  try {
    const forumChannel = (await client.channels.fetch(archiveForumChannelId)) as ForumChannel;
    const existingArchive = await archivedAppRepo.findOneBy({
      createdBy: application.createdBy,
      guildId,
    });

    if (!existingArchive) {
      const newPost = await forumChannel.threads.create({
        name: creatorUser?.username || 'Unknown',
        message: { content: transcript.header },
      });

      for (const chunk of transcript.chunks) {
        await newPost.send({ content: chunk });
      }

      await archivedAppRepo.save(
        archivedAppRepo.create({
          guildId,
          createdBy: application.createdBy,
          messageId: newPost.id,
        }),
      );
    } else if (existingArchive.messageId) {
      const post = (await forumChannel.threads.fetch(existingArchive.messageId)) as ForumThreadChannel;
      const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
      await post.send({ content: separator + transcript.header });
      for (const chunk of transcript.chunks) {
        await post.send({ content: chunk });
      }
    }
  } catch (error) {
    enhancedLogger.error('Failed to post application transcript to forum', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    archived = false;
  }

  if (archived) {
    enhancedLogger.info('Application transcript archived successfully', LogCategory.SYSTEM, {
      guildId,
      channelId,
      messageCount: transcript.messageCount,
      attachmentCount: transcript.attachmentCount,
    });
  } else {
    enhancedLogger.warn('Application closing despite archive failure', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
  }

  const deleteResult = await verifiedChannelDelete(channel, {
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

  return { success: true, archived };
}
