/**
 * Shared Ticket Close Workflow
 *
 * Extracts the common archive logic used by both the Discord button event
 * (events/ticket/close.ts) and the internal API handler (api/handlers/ticketHandlers.ts).
 *
 * Handles: transcript fetch → forum archive post (markdown-in-thread) →
 * tag management → channel delete. Callers are responsible for: finding
 * the ticket, marking it closed, and handling errors.
 */

import type { Client, ForumChannel, ForumThreadChannel, GuildTextBasedChannel } from 'discord.js';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import type { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { lazyRepo } from '../database/lazyRepo';
import { verifiedChannelDelete } from '../discord/verifiedDelete';
import { fetchMessagesAsTranscript } from '../fetchAllMessages';
import { applyForumTags, ensureForumTag } from '../forumTagManager';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { builtinTypeInfo, resolveTicketType } from './builtinTypes';
import { buildTranscript, type TicketMetadata, type TranscriptMessage } from './transcriptBuilder';

const archivedTicketRepo = lazyRepo(ArchivedTicket);

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
 * Resolve display info for a ticket's type (custom or builtin).
 *
 * Prefers `customTypeId` when present — an orphaned customTypeId (row deleted)
 * returns null rather than falling back to the `type` column, matching the
 * original branching behavior.
 */
async function resolveTicketTypeInfo(ticket: Ticket, guildId: string): Promise<TicketTypeInfo | null> {
  if (ticket.customTypeId) {
    const resolved = await resolveTicketType(guildId, ticket.customTypeId);
    if (resolved && !resolved.isBuiltin) {
      return {
        typeId: resolved.typeId,
        displayName: resolved.displayName,
        emoji: resolved.emoji,
      };
    }
    return null;
  }
  if (ticket.type) {
    const builtin = builtinTypeInfo(ticket.type);
    if (builtin) {
      return {
        typeId: builtin.typeId,
        displayName: builtin.displayName,
        emoji: builtin.emoji,
      };
    }
  }
  return null;
}

async function findExistingArchive(ticket: Ticket, guildId: string): Promise<ArchivedTicket | null> {
  if (ticket.isEmailTicket && ticket.emailSender) {
    return archivedTicketRepo.findOneBy({
      emailSender: ticket.emailSender,
      guildId,
    });
  }
  return archivedTicketRepo.findOneBy({ createdBy: ticket.createdBy, guildId });
}

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

  // Fetch the conversation as TranscriptMessage[] for the builder.
  let transcriptMessages: TranscriptMessage[];
  try {
    transcriptMessages = await fetchMessagesAsTranscript(channel, client.user?.id ?? '');
  } catch (error) {
    enhancedLogger.error('Failed to fetch ticket messages for transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return {
      success: false,
      archived: false,
      transcriptFailed: true,
      error: 'Transcript fetch failed',
    };
  }

  // Build header + chunks. Ticket metadata is resolved locally — type info
  // falls back to the ticket's stored type name when the custom row is gone.
  const typeInfo = await resolveTicketTypeInfo(ticket, guildId);
  const creatorUser = await client.users.fetch(ticket.createdBy).catch(() => null);
  const assignedUser = ticket.assignedTo ? await client.users.fetch(ticket.assignedTo).catch(() => null) : null;

  const metadata: TicketMetadata = {
    title: ticket.isEmailTicket && ticket.emailSubject ? ticket.emailSubject : typeInfo?.displayName || 'Ticket',
    type: typeInfo?.displayName || ticket.type || 'Unknown',
    createdByUsername:
      (ticket.isEmailTicket && ticket.emailSenderName) || creatorUser?.username || ticket.emailSender || 'Unknown',
    openedAt: ticket.lastActivityAt ? new Date(Math.min(ticket.lastActivityAt.getTime(), Date.now())) : new Date(),
    closedAt: new Date(),
    assignedToUsername: assignedUser?.username ?? null,
  };
  // Prefer the channel's createdAt as a more accurate open time when available.
  if ('createdAt' in channel && channel.createdAt instanceof Date) {
    metadata.openedAt = channel.createdAt;
  }

  const transcript = buildTranscript(transcriptMessages, metadata);

  let archived = true;
  try {
    const forumChannel = (await client.channels.fetch(archiveForumChannelId)) as ForumChannel;

    const forumTagIds: string[] = [];
    if (typeInfo) {
      const tagId = await ensureForumTag(forumChannel, typeInfo.typeId, typeInfo.displayName, typeInfo.emoji);
      if (tagId) forumTagIds.push(tagId);
    }

    const existingArchive = await findExistingArchive(ticket, guildId);

    if (!existingArchive) {
      // First-time close: create a new forum thread with the header as
      // the initial message, then post chunks as follow-ups.
      const threadName = await resolveArchiveThreadName(client, ticket);
      const newPost = await forumChannel.threads.create({
        name: threadName,
        message: { content: transcript.header },
      });

      if (forumTagIds.length > 0) {
        await applyForumTags(forumChannel, newPost.id, forumTagIds);
      }

      for (const chunk of transcript.chunks) {
        await newPost.send({ content: chunk });
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
      // Re-close for the same user: append a separator + header + chunks
      // to the existing thread. Tags still accumulate — "Forum Tag System"
      // per CLAUDE.md.
      const post = (await forumChannel.threads.fetch(existingArchive.messageId)) as ForumThreadChannel;

      const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
      await post.send({ content: separator + transcript.header });
      for (const chunk of transcript.chunks) {
        await post.send({ content: chunk });
      }

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
  } catch (error) {
    enhancedLogger.error('Failed to post ticket transcript to forum', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    // Archive failed but ticket is still closed — proceed to channel delete.
    archived = false;
  }

  if (archived) {
    enhancedLogger.info('Ticket transcript archived successfully', LogCategory.SYSTEM, {
      guildId,
      channelId,
      messageCount: transcript.messageCount,
      attachmentCount: transcript.attachmentCount,
    });
  } else {
    enhancedLogger.warn('Ticket closing despite archive failure', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
  }

  // Delete ticket channel (verified — Discord first, then DB)
  const deleteResult = await verifiedChannelDelete(channel, {
    guildId,
    label: 'ticket channel',
  });
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

  return { success: true, archived };
}
