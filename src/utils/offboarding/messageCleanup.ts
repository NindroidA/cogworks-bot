/**
 * Message Cleanup
 *
 * Three-phase teardown of all Cogworks-sent content in a guild:
 *  1. Tracked messages — fetch (channelId, messageId) pairs from config entities
 *  2. Threads + channels — delete archived ticket/application/memory threads and
 *     open ticket/application channels (when the caller exported them first,
 *     only the ones the export covers and that haven't changed since)
 *  3. Untracked bot messages — Discord's guild message-search API (with channel-scan fallback)
 *
 * Every thread/channel that is kept or fails to delete is reported in
 * `keptChannelIds`, and phase 3 leaves the messages inside it alone. When the
 * caller exported first, phase 3 also skips every thread in the archive and
 * memory forums (an orphaned archive thread with no DB row is in no export),
 * and it doesn't run at all if phase 2 couldn't list what to keep.
 *
 * Each phase is split into its own function so the orchestration in
 * `cleanupGuildMessages` reads top-to-bottom and the phases can be
 * tested independently.
 */

import { ChannelType, type Client, type ForumChannel, type TextChannel } from 'discord.js';
import { IsNull, Not } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { Application } from '../../typeorm/entities/application/Application';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import { MemoryConfig, MemoryItem } from '../../typeorm/entities/memory';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';
import { RulesConfig } from '../../typeorm/entities/rules';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { deleteChannelById, deleteIfExported, type ExportCoverage } from '../archive/transcriptCapture';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

export interface CleanupResult {
  deleted: number;
  failed: number;
  details: string[];
  /** Threads/channels left in Discord: not covered by the export, changed since, or failed to delete. */
  keptChannelIds: string[];
}

export interface CleanupOptions {
  /**
   * What the caller's export covers. When set, phase 2 deletes only those
   * threads/channels, and only while unchanged; anything else (unreadable,
   * opened or archived after the export, or with newer messages) is kept.
   */
  exported?: ExportCoverage;
}

/** What phase 3 must not touch: kept threads/channels, and every thread inside `keepParents`. */
interface SweepScope {
  keep: ReadonlySet<string>;
  keepParents: ReadonlySet<string>;
}

interface TrackedMessageRef {
  source: string;
  channelId: string;
  messageId: string;
}

/**
 * Delete a single message by channel ID and message ID.
 * Returns true if deleted or already gone, false on unexpected error.
 */
async function deleteMessage(client: Client, channelId: string, messageId: string): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return true; // Channel type mismatch — not our message
    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.delete();
    return true;
  } catch (error: any) {
    // 10008 = Unknown Message, 10003 = Unknown Channel — already gone, counts as success
    if (error?.code === 10008 || error?.code === 10003) return true;
    return false;
  }
}

/**
 * Phase 1: collect every (channelId, messageId) pair Cogworks has tracked
 * across config entities. No Discord I/O — DB-only.
 */
async function collectTrackedMessages(guildId: string): Promise<TrackedMessageRef[]> {
  const refs: TrackedMessageRef[] = [];

  try {
    const ticketConfig = await AppDataSource.getRepository(TicketConfig).findOneBy({ guildId });
    if (ticketConfig?.channelId && ticketConfig.messageId) {
      refs.push({ source: 'Ticket button', channelId: ticketConfig.channelId, messageId: ticketConfig.messageId });
    }

    const appConfig = await AppDataSource.getRepository(ApplicationConfig).findOneBy({ guildId });
    if (appConfig?.channelId && appConfig.messageId) {
      refs.push({ source: 'Application button', channelId: appConfig.channelId, messageId: appConfig.messageId });
    }

    const baitConfig = await AppDataSource.getRepository(BaitChannelConfig).findOneBy({ guildId });
    if (baitConfig?.channelId && baitConfig.channelMessageId) {
      refs.push({
        source: 'Bait warning',
        channelId: baitConfig.channelId,
        messageId: baitConfig.channelMessageId,
      });
    }

    const rulesConfig = await AppDataSource.getRepository(RulesConfig).findOneBy({ guildId });
    if (rulesConfig?.channelId && rulesConfig.messageId) {
      refs.push({ source: 'Rules message', channelId: rulesConfig.channelId, messageId: rulesConfig.messageId });
    }

    const archTicketConfig = await AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId });
    if (archTicketConfig?.channelId && archTicketConfig.messageId) {
      refs.push({
        source: 'Ticket archive',
        channelId: archTicketConfig.channelId,
        messageId: archTicketConfig.messageId,
      });
    }

    const archAppConfig = await AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({ guildId });
    if (archAppConfig?.channelId && archAppConfig.messageId) {
      refs.push({
        source: 'App archive',
        channelId: archAppConfig.channelId,
        messageId: archAppConfig.messageId,
      });
    }

    const reactionMenus = await AppDataSource.getRepository(ReactionRoleMenu).find({ where: { guildId } });
    for (const menu of reactionMenus) {
      if (menu.channelId && menu.messageId) {
        refs.push({
          source: `Reaction role: ${menu.name}`,
          channelId: menu.channelId,
          messageId: menu.messageId,
        });
      }
    }
  } catch (error) {
    enhancedLogger.error('Failed to collect messages for cleanup', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
  }

  return refs;
}

/** Phase 1 deletion: walk the tracked list, mutating `result` with counts. */
async function deleteTrackedMessages(client: Client, refs: TrackedMessageRef[], result: CleanupResult): Promise<void> {
  for (const { source, channelId, messageId } of refs) {
    const success = await deleteMessage(client, channelId, messageId);
    if (success) {
      result.deleted++;
      result.details.push(`Deleted: ${source}`);
    } else {
      result.failed++;
      result.details.push(`Failed: ${source}`);
    }
  }
}

/**
 * Phase 2: delete the threads and channels Cogworks created that hold
 * conversation content: archived ticket/application forum posts, memory item
 * threads, and still-open ticket/application channels (their DB rows are
 * purged next, so leaving them would strand them with dead Close buttons).
 * Returns false if the targets couldn't be listed or the walk stopped early.
 */
async function deleteContentChannels(
  client: Client,
  guildId: string,
  exported: ExportCoverage | undefined,
  result: CleanupResult,
): Promise<boolean> {
  try {
    const openWhere = { guildId, status: Not('closed'), channelId: Not(IsNull()) };
    const [archivedTickets, archivedApps, memoryItems, openTickets, openApps] = await Promise.all([
      AppDataSource.getRepository(ArchivedTicket).find({ where: { guildId } }),
      AppDataSource.getRepository(ArchivedApplication).find({ where: { guildId } }),
      AppDataSource.getRepository(MemoryItem).find({ where: { guildId } }),
      AppDataSource.getRepository(Ticket).find({ where: openWhere }),
      AppDataSource.getRepository(Application).find({ where: openWhere }),
    ]);
    type Target = [channelId: string | null, label: string];
    const targets: Target[] = [
      ...archivedTickets.map((t): Target => [t.messageId, 'archived ticket thread']),
      ...archivedApps.map((a): Target => [a.messageId, 'archived application thread']),
      ...memoryItems.map((i): Target => [i.threadId, 'memory thread']),
      ...openTickets.map((t): Target => [t.channelId, 'open ticket channel']),
      ...openApps.map((a): Target => [a.channelId, 'open application channel']),
    ];

    const seen = new Set<string>();
    for (const [channelId, label] of targets) {
      if (!channelId || seen.has(channelId)) continue;
      seen.add(channelId);
      const outcome = exported
        ? await deleteIfExported(client, guildId, exported, channelId, label)
        : await deleteChannelById(client, guildId, channelId, label);
      if (outcome === 'deleted') result.deleted++;
      if (outcome === 'kept') result.keptChannelIds.push(channelId);
      if (outcome === 'failed') {
        result.failed++;
        result.keptChannelIds.push(channelId);
        result.details.push(`Failed: ${label}`);
      }
    }
    return true;
  } catch (error) {
    enhancedLogger.warn('Thread/channel cleanup partially failed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Forums whose threads hold transcripts or memory discussions: the ticket/application archives and memory forums. */
async function transcriptForumIds(guildId: string): Promise<Set<string>> {
  const [ticketArchive, appArchive, memoryConfigs] = await Promise.all([
    AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(MemoryConfig).find({ where: { guildId } }),
  ]);
  const ids = [ticketArchive?.channelId, appArchive?.channelId, ...memoryConfigs.map(c => c.forumChannelId)];
  return new Set(ids.filter((id): id is string => !!id));
}

/**
 * Phase 3's scope after an export: kept channels plus every archive/memory
 * forum thread, since the export holds only the threads phase 2 matched to a
 * DB row. Null (skip phase 3) when phase 2 failed or the forums can't be read.
 */
async function exportedSweepScope(guildId: string, phase2Ok: boolean, keep: Set<string>): Promise<SweepScope | null> {
  if (!phase2Ok) return null;
  try {
    return { keep, keepParents: await transcriptForumIds(guildId) };
  } catch (error) {
    enhancedLogger.warn(
      'Could not list transcript forums; skipping the bot-message sweep',
      LogCategory.COMMAND_EXECUTION,
      {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}

/**
 * Phase 3: catch untracked bot messages via Discord's guild message-search
 * endpoint. Falls back to a channel-by-channel scan if search is unavailable.
 * Skips IDs already deleted in phase 1.
 */
async function searchAndDeleteUntrackedMessages(
  client: Client,
  guildId: string,
  trackedMessageIds: Set<string>,
  scope: SweepScope,
  result: CleanupResult,
): Promise<void> {
  const botId = client.user?.id;
  if (!botId) return;

  try {
    const usedSearch = await deleteViaSearchApi(client, guildId, botId, trackedMessageIds, scope, result);
    if (!usedSearch) {
      await deleteViaChannelScan(client, guildId, botId, scope, result);
    }
  } catch (error) {
    enhancedLogger.warn('Phase 2 message-search cleanup failed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Try the Discord guild message-search API. Returns `true` if the API
 * responded (even if it found nothing), `false` if it threw — caller should
 * then fall back to channel-scan.
 */
async function deleteViaSearchApi(
  client: Client,
  guildId: string,
  botId: string,
  trackedMessageIds: Set<string>,
  { keep, keepParents }: SweepScope,
  result: CleanupResult,
): Promise<boolean> {
  const rest = client.rest;
  const limit = 25;
  let offset = 0;

  while (offset < 200) {
    let searchResult: any;
    try {
      searchResult = await rest.get(
        `/guilds/${guildId}/messages/search?author_id=${botId}&sort_by=timestamp&limit=${limit}&offset=${offset}`,
      );
    } catch {
      // Search not available — caller will fall back to channel scan
      return false;
    }

    const messages = searchResult?.messages || [];
    if (messages.length === 0) return true;

    for (const messageGroup of messages) {
      // Search API returns arrays of message objects (each "hit" has context)
      const msg = Array.isArray(messageGroup) ? messageGroup[0] : messageGroup;
      if (!msg?.id || !msg?.channel_id) continue;
      if (trackedMessageIds.has(msg.id)) continue; // already deleted in phase 1
      if (keep.has(msg.channel_id)) continue; // kept thread/channel: its messages are the content

      try {
        const channel = await client.channels.fetch(msg.channel_id).catch(() => null);
        if (channel?.isThread() && channel.parentId && keepParents.has(channel.parentId)) continue;
        if (channel?.isTextBased()) {
          const fetchedMsg = await (channel as TextChannel).messages.fetch(msg.id).catch(() => null);
          if (fetchedMsg) {
            await fetchedMsg.delete();
            result.deleted++;
          }
        }
      } catch {
        // Inaccessible channel or already deleted — skip
      }
    }

    offset += limit;
  }

  return true;
}

/**
 * Fallback for environments where the search API is unavailable: scan every
 * accessible text channel + forum thread (active and archived) for bot
 * messages, delete what we can.
 */
async function deleteViaChannelScan(
  client: Client,
  guildId: string,
  botId: string,
  { keep, keepParents }: SweepScope,
  result: CleanupResult,
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // Plain text channels
  const textChannels = guild.channels.cache.filter(ch => ch.isTextBased() && !ch.isThread() && !keep.has(ch.id));
  for (const [, channel] of textChannels) {
    try {
      const messages = await (channel as TextChannel).messages.fetch({ limit: 50 });
      const botMessages = messages.filter(m => m.author.id === botId);
      for (const [, msg] of botMessages) {
        try {
          await msg.delete();
          result.deleted++;
        } catch {
          /* undeletable */
        }
      }
    } catch {
      /* can't access channel */
    }
  }

  // Forum channels — messages live inside threads
  const forumChannels = guild.channels.cache.filter(
    ch => ch.type === ChannelType.GuildForum && !keepParents.has(ch.id),
  );
  for (const [, forum] of forumChannels) {
    try {
      const active = await (forum as ForumChannel).threads.fetchActive();
      const archived = await (forum as ForumChannel).threads.fetchArchived();
      for (const threads of [active.threads, archived.threads]) {
        for (const [, thread] of threads) {
          if (keep.has(thread.id)) continue;
          try {
            const messages = await thread.messages.fetch({ limit: 50 });
            const botMessages = messages.filter((m: any) => m.author.id === botId);
            for (const [, msg] of botMessages) {
              try {
                await msg.delete();
                result.deleted++;
              } catch {
                /* undeletable */
              }
            }
          } catch {
            /* can't access thread */
          }
        }
      }
    } catch {
      /* can't access forum */
    }
  }
}

/**
 * Clean up all Cogworks-sent messages in a guild.
 *
 * Three phases run in sequence (each phase mutates `result`):
 *   1. Tracked messages from config entities
 *   2. Threads + open channels created by Cogworks (only what `exported` covers, when set)
 *   3. Untracked bot messages via search API + scan fallback, outside kept channels
 *      (and, after an export, outside the archive/memory forums; skipped if phase 2 failed)
 */
export async function cleanupGuildMessages(
  client: Client,
  guildId: string,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, failed: 0, details: [], keptChannelIds: [] };

  const tracked = await collectTrackedMessages(guildId);
  await deleteTrackedMessages(client, tracked, result);
  const phase2Ok = await deleteContentChannels(client, guildId, options.exported, result);
  const keep = new Set(result.keptChannelIds);
  const scope = options.exported
    ? await exportedSweepScope(guildId, phase2Ok, keep)
    : { keep, keepParents: new Set<string>() };
  if (scope) {
    await searchAndDeleteUntrackedMessages(client, guildId, new Set(tracked.map(t => t.messageId)), scope, result);
  }

  enhancedLogger.info('Guild message cleanup complete', LogCategory.COMMAND_EXECUTION, {
    guildId,
    deleted: result.deleted,
    failed: result.failed,
    kept: result.keptChannelIds.length,
  });

  return result;
}
