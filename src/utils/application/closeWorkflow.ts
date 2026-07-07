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
import { Position } from '../../typeorm/entities/application/Position';
import { Colors } from '../colors';
import { lazyRepo } from '../database/lazyRepo';
import { verifiedChannelDelete } from '../discord/verifiedDelete';
import { fetchMessagesAsTranscript } from '../fetchAllMessages';
import { applyForumTags, ensureForumTag } from '../forumTagManager';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { CloseActor } from '../ticket/closeWorkflow';
import { buildTranscript, type TicketMetadata, type TranscriptMessage } from '../ticket/transcriptBuilder';
import { buildHeaderEmbed, postTranscriptToThread } from '../ticket/transcriptPoster';

const archivedAppRepo = lazyRepo(ArchivedApplication);
const positionRepo = lazyRepo(Position);

export interface ArchiveApplicationResult {
  success: boolean;
  archived: boolean;
  /**
   * Whether the source application channel was actually deleted. Only
   * meaningful when `archived` is true: the transcript was saved but the
   * channel delete failed, so it's still live and the caller should say so.
   */
  channelDeleted?: boolean;
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
  positionRepo: typeof positionRepo;
  ensureForumTag: typeof ensureForumTag;
  applyForumTags: typeof applyForumTags;
}

const defaultDeps: CloseApplicationWorkflowDeps = {
  fetchMessagesAsTranscript,
  verifiedChannelDelete,
  archivedAppRepo,
  positionRepo,
  ensureForumTag,
  applyForumTags,
};

/** Union of existing + incoming forum tag ids, order-preserving, deduped.
 * Mirrors the ticket close workflow's helper. */
function mergeForumTags(existing: string[] | null | undefined, incoming: string[]): string[] {
  const merged = [...(existing ?? [])];
  for (const tag of incoming) {
    if (!merged.includes(tag)) merged.push(tag);
  }
  return merged;
}

/**
 * Resolve the Position row an application was submitted for. `type` carries
 * `position_<id>` (see events/application/apply.ts); the row may have been
 * deleted since — return null and let the header fall back to the generic
 * "Application" label rather than throwing in the un-try'd metadata region
 * (the v3.14.2 bug class).
 */
async function resolveApplicationPosition(
  application: Application,
  guildId: string,
  deps: CloseApplicationWorkflowDeps,
): Promise<Position | null> {
  const raw = application.type?.startsWith('position_') ? Number(application.type.slice('position_'.length)) : NaN;
  if (!Number.isInteger(raw)) return null;
  return deps.positionRepo.findOneBy({ id: raw, guildId }).catch(() => null);
}

/**
 * Outcome label from the application's terminal state. Two vocabularies
 * exist: the API approve/deny routes set `status` to 'accepted'/'rejected',
 * while the Discord workflow writes 'approved'/'denied' status-history
 * entries. `claimClose` flips only the DB row, so the in-memory entity still
 * carries the pre-close status; fall back to the newest decisive history
 * entry when the current status isn't itself an outcome.
 */
// A Map, not an object literal: application.status is admin-extensible
// (/application workflow-add-status accepts any /^[a-z0-9-]{1,20}$/ id, which
// admits 'constructor'), and an object-literal lookup on such a key would
// return an inherited Object.prototype member (a function) that then throws
// when the embed builder rejects the non-string field value.
const OUTCOME_LABELS = new Map<string, string>([
  ['accepted', 'Accepted'],
  ['approved', 'Accepted'],
  ['rejected', 'Rejected'],
  ['denied', 'Rejected'],
]);

function outcomeLabel(status: string): string | null {
  return OUTCOME_LABELS.get(status) ?? null;
}

function resolveApplicationOutcome(application: Application): string | null {
  const current = outcomeLabel(application.status);
  if (current) return current;
  // Current status isn't itself a decision (usually 'closed' after the flip).
  // Scan history newest-first, skipping the terminal 'closed' entry (the close
  // action, not a decision). The FIRST substantive entry decides: if it's
  // decisive that's the outcome; if it's anything else, an earlier decision
  // was retracted (e.g. approved → moved back to under-review) and we report
  // no outcome rather than resurrecting the withdrawn one.
  const history = application.statusHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === 'closed') continue;
    return outcomeLabel(history[i].status);
  }
  return null;
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
  deps: CloseApplicationWorkflowDeps = defaultDeps,
  closedBy?: CloseActor,
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

  // Independent lookups — run concurrently (mirrors ticket closeWorkflow).
  const [creatorUser, position, reviewedByUser, closedByUser] = await Promise.all([
    client.users.fetch(application.createdBy).catch(() => null),
    resolveApplicationPosition(application, guildId, deps),
    application.reviewedBy ? client.users.fetch(application.reviewedBy).catch(() => null) : Promise.resolve(null),
    // API closes only carry the actor's id — resolve the username here.
    closedBy?.id && !closedBy.username ? client.users.fetch(closedBy.id).catch(() => null) : Promise.resolve(null),
  ]);

  const threadName = creatorUser?.username || 'Unknown';
  const positionLabel = position ? `${position.emoji ? `${position.emoji} ` : ''}${position.title}` : null;
  const metadata: TicketMetadata = {
    title: positionLabel ? `${positionLabel} — ${threadName}` : `Application — ${threadName}`,
    type: position?.title ?? 'Application',
    createdByUsername: threadName,
    openedAt: 'createdAt' in channel && channel.createdAt instanceof Date ? channel.createdAt : new Date(),
    closedAt: new Date(),
    assignedToUsername: null,
    kind: 'application',
    createdById: application.createdBy,
    entityId: application.id,
    closedByUsername: closedBy?.username ?? closedByUser?.username ?? null,
    closedById: closedBy?.id ?? null,
    outcome: resolveApplicationOutcome(application),
    reviewedByUsername: reviewedByUser?.username ?? null,
    reviewedById: application.reviewedBy ?? null,
  };

  const transcript = buildTranscript(transcriptMessages, metadata);
  const headerEmbed = buildHeaderEmbed(transcript.headerData, Colors.application.review);

  let archived = true;
  try {
    const forumChannel = (await client.channels.fetch(archiveForumChannelId)) as ForumChannel;

    // Forum tags for the archive thread: the position applied for, and the
    // Accepted/Rejected outcome. Both are best-effort — ensureForumTag returns
    // null at the 20-tag forum cap or on API error, and we simply skip it.
    const forumTagIds: string[] = [];
    if (position) {
      const tagId = await deps.ensureForumTag(forumChannel, `position_${position.id}`, position.title, position.emoji);
      if (tagId) forumTagIds.push(tagId);
    }
    if (metadata.outcome) {
      const tagId = await deps.ensureForumTag(
        forumChannel,
        `outcome_${metadata.outcome.toLowerCase()}`,
        metadata.outcome,
        metadata.outcome === 'Accepted' ? '✅' : '❌',
      );
      if (tagId) forumTagIds.push(tagId);
    }

    const existingArchive = await deps.archivedAppRepo.findOneBy({
      createdBy: application.createdBy,
      guildId,
    });

    if (!existingArchive) {
      const newPost = await forumChannel.threads.create({
        name: threadName,
        // allowedMentions parse:[] — historical transcript, never ping anyone.
        message: { embeds: [headerEmbed], allowedMentions: { parse: [] } },
      });

      if (forumTagIds.length > 0) {
        await deps.applyForumTags(forumChannel, newPost.id, forumTagIds);
      }

      // Persist the archive row BEFORE posting chunks: a chunk failure then
      // leaves the row pointing at this thread, so the retry appends instead of
      // orphaning it and creating a duplicate.
      await deps.archivedAppRepo.save(
        deps.archivedAppRepo.create({
          guildId,
          createdBy: application.createdBy,
          messageId: newPost.id,
          forumTagIds,
        }),
      );

      await postTranscriptToThread(newPost, transcript.chunks, { guildId, channelId, label: 'Application transcript' });
    } else {
      // Re-close: reuse the archive thread, but it may have been deleted out
      // from under us. force:true bypasses the cache; catch ONLY 10003 (Unknown
      // Channel) and recreate so the transcript is never lost — let other errors
      // bubble to the outer catch (marks archived:false, preserves the channel).
      // A row with a NULL messageId also takes the recreate path — it previously
      // matched neither branch, deleting the channel with the transcript never
      // posted anywhere (silent data loss).
      const post = existingArchive.messageId
        ? ((await forumChannel.threads.fetch(existingArchive.messageId, { force: true }).catch((err: unknown) => {
            if ((err as { code?: number })?.code === 10003) return null;
            throw err;
          })) as ForumThreadChannel | null)
        : null;

      if (!post) {
        const newPost = await forumChannel.threads.create({
          name: threadName,
          message: { embeds: [headerEmbed], allowedMentions: { parse: [] } },
        });
        const mergedTags = mergeForumTags(existingArchive.forumTagIds, forumTagIds);
        if (mergedTags.length > 0) {
          await deps.applyForumTags(forumChannel, newPost.id, mergedTags);
        }
        // Repoint + persist BEFORE chunks so a chunk failure can't orphan it.
        existingArchive.messageId = newPost.id;
        existingArchive.forumTagIds = mergedTags;
        await deps.archivedAppRepo.save(existingArchive);
        await postTranscriptToThread(newPost, transcript.chunks, {
          guildId,
          channelId,
          label: 'Application transcript',
        });
      } else {
        // A fresh header embed is the visual divider between closes.
        await post.send({
          embeds: [headerEmbed],
          allowedMentions: { parse: [] },
        });
        await postTranscriptToThread(post, transcript.chunks, { guildId, channelId, label: 'Application transcript' });

        // Accumulate tags onto the existing thread — persist only what actually
        // landed (the 5-tag cap can drop some; recording a dropped tag would
        // make future closes skip re-applying it while the thread never shows it).
        const mergedTags = mergeForumTags(existingArchive.forumTagIds, forumTagIds);
        if (mergedTags.length > (existingArchive.forumTagIds?.length ?? 0)) {
          const applied = await deps.applyForumTags(forumChannel, post.id, mergedTags);
          if (applied) {
            existingArchive.forumTagIds = applied;
            await deps.archivedAppRepo.save(existingArchive);
          }
        }
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

  return { success: true, archived: true, channelDeleted: deleteResult.success };
}
