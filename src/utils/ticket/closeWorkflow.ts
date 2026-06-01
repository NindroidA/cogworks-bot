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

/**
 * Injectable seam dependencies for {@link archiveAndCloseTicket}.
 *
 * Production callers omit this — the defaults bind the real module functions.
 * Tests pass fakes directly instead of relying on `mock.module()`, which bun
 * applies inconsistently across a full-suite run on Linux (the SUT could bind
 * the real forum/transcript functions and silently produce archived:false —
 * flaky CI, 2026-05-30). Direct injection is deterministic on every platform.
 */
export interface CloseWorkflowDeps {
  fetchMessagesAsTranscript: typeof fetchMessagesAsTranscript;
  ensureForumTag: typeof ensureForumTag;
  applyForumTags: typeof applyForumTags;
  verifiedChannelDelete: typeof verifiedChannelDelete;
  resolveTicketType: typeof resolveTicketType;
  builtinTypeInfo: typeof builtinTypeInfo;
  archivedTicketRepo: typeof archivedTicketRepo;
}

const defaultDeps: CloseWorkflowDeps = {
  fetchMessagesAsTranscript,
  ensureForumTag,
  applyForumTags,
  verifiedChannelDelete,
  resolveTicketType,
  builtinTypeInfo,
  archivedTicketRepo,
};

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
async function resolveTicketTypeInfo(
  ticket: Ticket,
  guildId: string,
  deps: CloseWorkflowDeps,
): Promise<TicketTypeInfo | null> {
  if (ticket.customTypeId) {
    const resolved = await deps.resolveTicketType(guildId, ticket.customTypeId);
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
    const builtin = deps.builtinTypeInfo(ticket.type);
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

async function findExistingArchive(
  ticket: Ticket,
  guildId: string,
  repo: CloseWorkflowDeps['archivedTicketRepo'],
): Promise<ArchivedTicket | null> {
  // Email-import tickets and normal tickets live in SEPARATE archive
  // namespaces and must never share a thread. An email-import ticket's
  // `createdBy` is the importing admin, NOT the player it represents — so
  // without the `isEmailTicket` discriminator a normal ticket the admin opens
  // would match (and get appended into) an email-import archive that happens
  // to share their `createdBy`. Scope each lookup to its own kind.
  if (ticket.isEmailTicket && ticket.emailSender) {
    return repo.findOneBy({
      guildId,
      isEmailTicket: true,
      emailSender: ticket.emailSender,
    });
  }
  return repo.findOneBy({
    guildId,
    isEmailTicket: false,
    createdBy: ticket.createdBy,
  });
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
  deps: CloseWorkflowDeps = defaultDeps,
): Promise<ArchiveTicketResult> {
  const channelId = ticket.channelId || '';

  // Fetch the conversation as TranscriptMessage[] for the builder.
  let transcriptMessages: TranscriptMessage[];
  try {
    transcriptMessages = await deps.fetchMessagesAsTranscript(channel, client.user?.id ?? '');
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
  const typeInfo = await resolveTicketTypeInfo(ticket, guildId, deps);
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
      const tagId = await deps.ensureForumTag(forumChannel, typeInfo.typeId, typeInfo.displayName, typeInfo.emoji);
      if (tagId) forumTagIds.push(tagId);
    }

    const existingArchive = await findExistingArchive(ticket, guildId, deps.archivedTicketRepo);

    if (!existingArchive) {
      // First-time close: create a new forum thread with the header as
      // the initial message, then post chunks as follow-ups.
      const threadName = await resolveArchiveThreadName(client, ticket);
      const newPost = await forumChannel.threads.create({
        name: threadName,
        // allowedMentions parse:[] — the transcript is historical content; it
        // must never ping anyone (@everyone/@here/user/role) when re-posted.
        message: { content: transcript.header, allowedMentions: { parse: [] } },
      });

      if (forumTagIds.length > 0) {
        await deps.applyForumTags(forumChannel, newPost.id, forumTagIds);
      }

      for (const chunk of transcript.chunks) {
        await newPost.send({ content: chunk, allowedMentions: { parse: [] } });
      }

      await deps.archivedTicketRepo.save(
        deps.archivedTicketRepo.create({
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
      await post.send({
        content: separator + transcript.header,
        allowedMentions: { parse: [] },
      });
      for (const chunk of transcript.chunks) {
        await post.send({ content: chunk, allowedMentions: { parse: [] } });
      }

      if (forumTagIds.length > 0) {
        const existingTags = existingArchive.forumTagIds || [];
        const newTagId = forumTagIds[0];
        if (!existingTags.includes(newTagId)) {
          const mergedTags = [...existingTags, newTagId];
          await deps.applyForumTags(forumChannel, existingArchive.messageId, mergedTags);
          existingArchive.forumTagIds = mergedTags;
          await deps.archivedTicketRepo.save(existingArchive);
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
  const deleteResult = await deps.verifiedChannelDelete(channel, {
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
