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
 * Post each transcript chunk to the thread. Never pings (historical content),
 * and attributes a failed send to its chunk index so a partial-archive failure
 * is diagnosable. Rethrows so the caller marks the archive failed.
 */
async function sendTranscriptChunks(
  thread: ForumThreadChannel,
  chunks: string[],
  ctx: { guildId: string; channelId: string },
): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    try {
      await thread.send({ content: chunks[i], allowedMentions: { parse: [] } });
    } catch (error) {
      enhancedLogger.error(
        `Transcript chunk ${i + 1}/${chunks.length} failed to post`,
        error as Error,
        LogCategory.SYSTEM,
        ctx,
      );
      throw error;
    }
  }
}

/** Union of existing + incoming forum tag ids, order-preserving, deduped. */
function mergeForumTags(existing: string[] | null | undefined, incoming: string[]): string[] {
  const merged = [...(existing ?? [])];
  for (const tag of incoming) {
    if (!merged.includes(tag)) merged.push(tag);
  }
  return merged;
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

      // Persist the archive row BEFORE posting chunks. If a chunk send fails
      // mid-archive, the row already points at this thread, so the B2 retry
      // appends to it (via the re-close branch) instead of orphaning it and
      // creating a duplicate thread.
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

      await sendTranscriptChunks(newPost, transcript.chunks, {
        guildId,
        channelId,
      });
    } else if (existingArchive.messageId) {
      // Re-close for the same user. The archive thread is reused — but it may
      // have been deleted out from under us (manual delete, /archive cleanup).
      // Catch ONLY 10003 (Unknown Channel) and recreate so the transcript is
      // never lost; let permission/transient errors bubble to the outer catch
      // (which marks archived:false and preserves the source channel for retry).
      // force:true bypasses the channel cache so a thread deleted while the bot
      // was offline (missed THREAD_DELETE) still surfaces as gone (10003 or a
      // null fetch) and engages the recreate path, instead of returning a stale
      // cached object we'd post into the void.
      const post = (await forumChannel.threads
        .fetch(existingArchive.messageId, { force: true })
        .catch((err: unknown) => {
          if ((err as { code?: number })?.code === 10003) return null;
          throw err;
        })) as ForumThreadChannel | null;

      if (!post) {
        // Thread gone: recreate it (header as the initial message), re-apply
        // the accumulated tags, repoint the archive row, and post the chunks.
        const threadName = await resolveArchiveThreadName(client, ticket);
        const newPost = await forumChannel.threads.create({
          name: threadName,
          message: {
            content: transcript.header,
            allowedMentions: { parse: [] },
          },
        });
        const mergedTags = mergeForumTags(existingArchive.forumTagIds, forumTagIds);
        if (mergedTags.length > 0) {
          await deps.applyForumTags(forumChannel, newPost.id, mergedTags);
        }
        // Repoint + persist BEFORE chunks so a chunk failure can't orphan the
        // new thread — a retry finds this row and appends to it.
        existingArchive.messageId = newPost.id;
        existingArchive.forumTagIds = mergedTags;
        await deps.archivedTicketRepo.save(existingArchive);
        await sendTranscriptChunks(newPost, transcript.chunks, {
          guildId,
          channelId,
        });
      } else {
        // Normal append: separator + header + chunks into the existing thread.
        // Tags still accumulate — "Forum Tag System" per CLAUDE.md.
        const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
        await post.send({
          content: separator + transcript.header,
          allowedMentions: { parse: [] },
        });
        await sendTranscriptChunks(post, transcript.chunks, {
          guildId,
          channelId,
        });

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
    }
  } catch (error) {
    enhancedLogger.error('Failed to post ticket transcript to forum', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    archived = false;
  }

  if (!archived) {
    // Archive failed. DO NOT delete the source channel — that would destroy the
    // only remaining copy of the conversation. Preserve it so the close can be
    // retried; the caller reverts the ticket status so the retry isn't blocked
    // by the duplicate-close guard.
    enhancedLogger.warn('Ticket archive failed — preserving channel + ticket for retry', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return { success: false, archived: false };
  }

  enhancedLogger.info('Ticket transcript archived successfully', LogCategory.SYSTEM, {
    guildId,
    channelId,
    messageCount: transcript.messageCount,
    attachmentCount: transcript.attachmentCount,
  });

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

  return { success: true, archived: true };
}
