/**
 * Message Cleanup
 *
 * Three-phase teardown of all Cogworks-sent content in a guild:
 *  1. Tracked messages — fetch (channelId, messageId) pairs from config entities
 *  2. Forum threads — delete archived ticket/application/memory threads
 *  3. Untracked bot messages — Discord's guild message-search API (with channel-scan fallback)
 *
 * Each phase is split into its own function so the orchestration in
 * `cleanupGuildMessages` reads top-to-bottom and the phases can be
 * tested independently.
 */

import { ChannelType, type Client, type ForumChannel, type TextChannel } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import { MemoryConfig, MemoryItem } from '../../typeorm/entities/memory';
import { ReactionRoleMenu } from '../../typeorm/entities/reactionRole';
import { RulesConfig } from '../../typeorm/entities/rules';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

interface CleanupResult {
  deleted: number;
  failed: number;
  details: string[];
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
 * Phase 2: delete forum threads created by Cogworks (archived ticket forum
 * posts, archived application forum posts, memory item threads). Each forum
 * is handled the same way: fetch parent forum, iterate child entries, delete
 * each thread (or skip if already gone).
 */
async function deleteForumThreads(client: Client, guildId: string, result: CleanupResult): Promise<void> {
  try {
    const archTicketConfig = await AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId });
    if (archTicketConfig?.channelId) {
      const archivedTickets = await AppDataSource.getRepository(ArchivedTicket).find({ where: { guildId } });
      await deleteForumEntries(
        client,
        archTicketConfig.channelId,
        archivedTickets.map(t => t.messageId).filter((id): id is string => !!id),
        result,
      );
    }

    const archAppConfig = await AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({ guildId });
    if (archAppConfig?.channelId) {
      const archivedApps = await AppDataSource.getRepository(ArchivedApplication).find({ where: { guildId } });
      await deleteForumEntries(
        client,
        archAppConfig.channelId,
        archivedApps.map(a => a.messageId).filter((id): id is string => !!id),
        result,
      );
    }

    const memoryConfigs = await AppDataSource.getRepository(MemoryConfig).find({ where: { guildId } });
    for (const memConfig of memoryConfigs) {
      if (!memConfig.forumChannelId) continue;
      const memoryItems = await AppDataSource.getRepository(MemoryItem).find({
        where: { guildId, memoryConfigId: memConfig.id },
      });
      await deleteForumEntries(
        client,
        memConfig.forumChannelId,
        memoryItems.map(i => i.threadId).filter((id): id is string => !!id),
        result,
      );
    }
  } catch (error) {
    enhancedLogger.warn('Forum thread cleanup partially failed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Helper: delete a list of thread IDs from a forum channel. Best-effort. */
async function deleteForumEntries(
  client: Client,
  forumChannelId: string,
  threadIds: string[],
  result: CleanupResult,
): Promise<void> {
  if (threadIds.length === 0) return;
  const forumChannel = (await client.channels.fetch(forumChannelId).catch(() => null)) as ForumChannel | null;
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;

  for (const threadId of threadIds) {
    try {
      const thread = await forumChannel.threads.fetch(threadId).catch(() => null);
      if (thread) {
        await thread.delete('Bot reset cleanup');
        result.deleted++;
      }
    } catch {
      /* thread already gone */
    }
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
  result: CleanupResult,
): Promise<void> {
  const botId = client.user?.id;
  if (!botId) return;

  try {
    const usedSearch = await deleteViaSearchApi(client, guildId, botId, trackedMessageIds, result);
    if (!usedSearch) {
      await deleteViaChannelScan(client, guildId, botId, result);
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

      try {
        const channel = await client.channels.fetch(msg.channel_id).catch(() => null);
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
  result: CleanupResult,
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // Plain text channels
  const textChannels = guild.channels.cache.filter(ch => ch.isTextBased() && !ch.isThread());
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
  const forumChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildForum);
  for (const [, forum] of forumChannels) {
    try {
      const active = await (forum as ForumChannel).threads.fetchActive();
      const archived = await (forum as ForumChannel).threads.fetchArchived();
      for (const threads of [active.threads, archived.threads]) {
        for (const [, thread] of threads) {
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
 *   2. Forum threads created by Cogworks
 *   3. Untracked bot messages via search API + scan fallback
 */
export async function cleanupGuildMessages(client: Client, guildId: string): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, failed: 0, details: [] };

  const tracked = await collectTrackedMessages(guildId);
  await deleteTrackedMessages(client, tracked, result);
  await deleteForumThreads(client, guildId, result);
  await searchAndDeleteUntrackedMessages(client, guildId, new Set(tracked.map(t => t.messageId)), result);

  enhancedLogger.info('Guild message cleanup complete', LogCategory.COMMAND_EXECUTION, {
    guildId,
    deleted: result.deleted,
    failed: result.failed,
  });

  return result;
}
