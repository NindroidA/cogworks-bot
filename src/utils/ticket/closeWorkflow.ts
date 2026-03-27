/**
 * Shared Ticket Close Workflow
 *
 * Extracts the common archive logic used by both the Discord button event
 * (events/ticket/close.ts) and the internal API handler (api/handlers/ticketHandlers.ts).
 *
 * Handles: transcript creation → forum archive → tag management → temp cleanup → channel delete.
 * Callers are responsible for: finding the ticket, marking it closed, and handling errors.
 */

import fs from 'node:fs';
import type { Client, ForumChannel, ForumThreadChannel, GuildTextBasedChannel } from 'discord.js';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import type { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { lazyRepo } from '../database/lazyRepo';
import { verifiedChannelDelete } from '../discord/verifiedDelete';
import { fetchMessagesAndSaveToFile } from '../fetchAllMessages';
import { applyForumTags, ensureForumTag } from '../forumTagManager';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { isLegacyTicketType, LEGACY_TYPE_INFO } from './legacyTypes';

const archivedTicketRepo = lazyRepo(ArchivedTicket);
const customTicketTypeRepo = lazyRepo(CustomTicketType);

export interface ArchiveTicketResult {
  success: boolean;
  archived: boolean;
  postId?: string;
  transcriptFailed?: boolean;
  error?: string;
}

interface TicketTypeInfo {
  typeId: string;
  displayName: string;
  emoji: string | null;
}

/**
 * Resolve display info for a ticket's type (custom or legacy).
 */
async function resolveTicketTypeInfo(ticket: Ticket, guildId: string): Promise<TicketTypeInfo | null> {
  if (ticket.customTypeId) {
    const customType = await customTicketTypeRepo.findOne({
      where: { guildId, typeId: ticket.customTypeId },
    });
    if (customType) {
      return { typeId: customType.typeId, displayName: customType.displayName, emoji: customType.emoji };
    }
  } else if (ticket.type && isLegacyTicketType(ticket.type)) {
    const info = LEGACY_TYPE_INFO[ticket.type];
    return { typeId: ticket.type, displayName: info.display, emoji: info.emoji };
  }
  return null;
}

/**
 * Find existing archive thread for this ticket's creator (or email sender).
 */
async function findExistingArchive(ticket: Ticket, guildId: string): Promise<ArchivedTicket | null> {
  if (ticket.isEmailTicket && ticket.emailSender) {
    return archivedTicketRepo.findOneBy({ emailSender: ticket.emailSender, guildId });
  }
  return archivedTicketRepo.findOneBy({ createdBy: ticket.createdBy, guildId });
}

/**
 * Resolve the thread name for a new archive post.
 */
async function resolveArchiveThreadName(client: Client, ticket: Ticket): Promise<string> {
  if (ticket.isEmailTicket && ticket.emailSender) {
    return ticket.emailSenderName || ticket.emailSender.split('@')[0];
  }
  const user = await client.users.fetch(ticket.createdBy).catch(() => null);
  return user?.username || 'Unknown';
}

/**
 * Archive a ticket to the forum channel and clean up.
 *
 * This is the shared core that both the event handler and API handler call.
 * It does NOT mark the ticket as closed — callers must do that before calling.
 */
export async function archiveAndCloseTicket(
  client: Client,
  ticket: Ticket,
  guildId: string,
  channel: GuildTextBasedChannel,
  archiveForumChannelId: string,
): Promise<ArchiveTicketResult> {
  const channelId = ticket.channelId || '';
  const transcriptPath = process.env.TEMP_STORAGE_PATH || 'temp/';

  // Ensure transcript directory exists
  await fs.promises.mkdir(transcriptPath, { recursive: true });

  // Create transcript
  try {
    await fetchMessagesAndSaveToFile(channel, transcriptPath);
  } catch (error) {
    enhancedLogger.error('Failed to create ticket transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return { success: false, archived: false, transcriptFailed: true, error: 'Transcript creation failed' };
  }

  // Archive to forum
  try {
    const forumChannel = (await client.channels.fetch(archiveForumChannelId)) as ForumChannel;
    const txtPath = `${transcriptPath}${channelId}.txt`;
    const zipPath = `${transcriptPath}attachments_${channelId}.zip`;
    const files = [txtPath];
    const hasZip = fs.existsSync(zipPath);
    if (hasZip) files.push(zipPath);

    // Resolve ticket type info (custom or legacy) for forum tags
    const typeInfo = await resolveTicketTypeInfo(ticket, guildId);

    // Build forum tags
    const forumTagIds: string[] = [];
    if (typeInfo) {
      const tagId = await ensureForumTag(forumChannel, typeInfo.typeId, typeInfo.displayName, typeInfo.emoji);
      if (tagId) forumTagIds.push(tagId);
    }

    // Find or create archive thread
    const existingArchive = await findExistingArchive(ticket, guildId);

    if (!existingArchive) {
      // First-time close: create new archive thread
      const threadName = await resolveArchiveThreadName(client, ticket);
      const newPost = await forumChannel.threads.create({
        name: threadName,
        message: { files },
      });

      if (forumTagIds.length > 0) {
        await applyForumTags(forumChannel, newPost.id, forumTagIds);
      }

      await archivedTicketRepo.save(
        archivedTicketRepo.create({
          guildId,
          createdBy: ticket.createdBy,
          messageId: newPost.id,
          ticketType: ticket.type,
          customTypeId: ticket.customTypeId,
          forumTagIds,
          isEmailTicket: ticket.isEmailTicket || false,
          emailSender: ticket.emailSender,
          emailSenderName: ticket.emailSenderName,
          emailSubject: ticket.emailSubject,
        }),
      );
    } else if (existingArchive.messageId) {
      // Existing archive: add transcript and merge tags
      const post = (await forumChannel.threads.fetch(existingArchive.messageId)) as ForumThreadChannel;
      await post.send({ files });

      // Merge new forum tags with existing (accumulate, don't replace)
      if (forumTagIds.length > 0) {
        const existingTags = existingArchive.forumTagIds || [];
        const newTagId = forumTagIds[0];
        if (!existingTags.includes(newTagId)) {
          const mergedTags = [...existingTags, newTagId];
          await applyForumTags(forumChannel, existingArchive.messageId, mergedTags);
          existingArchive.forumTagIds = mergedTags;
          await archivedTicketRepo.save(existingArchive);
        }
      }
    }

    // Cleanup temp files
    await fs.promises.unlink(txtPath).catch(err => {
      enhancedLogger.error('Failed to delete ticket transcript file', err as Error, LogCategory.SYSTEM, {
        guildId,
        txtPath,
      });
    });
    if (hasZip) {
      await fs.promises.unlink(zipPath).catch(err => {
        enhancedLogger.error('Failed to delete ticket attachment zip', err as Error, LogCategory.SYSTEM, {
          guildId,
          zipPath,
        });
      });
    }
  } catch (error) {
    enhancedLogger.error('Failed to send ticket transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    // Archive failed but ticket is still closed — proceed to channel delete
  }

  enhancedLogger.info('Ticket transcript archived successfully', LogCategory.SYSTEM, { guildId, channelId });

  // Delete ticket channel (verified — Discord first, then DB)
  const deleteResult = await verifiedChannelDelete(channel, { guildId, label: 'ticket channel' });
  if (!deleteResult.success) {
    enhancedLogger.error(
      `Ticket channel persisted after delete attempt — possible bug. Channel: ${channelId}`,
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
