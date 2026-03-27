/**
 * Message Cleanup
 *
 * Deletes all Cogworks-sent messages in a guild by iterating through
 * stored message IDs in config entities.
 */

import { ChannelType, type Client, type ForumChannel, type TextChannel } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../../typeorm/entities/BaitChannelConfig';
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
    // Real error (permissions, network, etc.) — count as failure
    return false;
  }
}

/**
 * Clean up all Cogworks-sent messages in a guild.
 * Iterates through all config entities that store message IDs.
 */
export async function cleanupGuildMessages(client: Client, guildId: string): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, failed: 0, details: [] };

  // Collect all (channelId, messageId) pairs from config entities
  const messagesToDelete: Array<{
    source: string;
    channelId: string;
    messageId: string;
  }> = [];

  try {
    // Ticket creation button
    const ticketConfig = await AppDataSource.getRepository(TicketConfig).findOneBy({ guildId });
    if (ticketConfig?.channelId && ticketConfig.messageId) {
      messagesToDelete.push({
        source: 'Ticket button',
        channelId: ticketConfig.channelId,
        messageId: ticketConfig.messageId,
      });
    }

    // Application button
    const appConfig = await AppDataSource.getRepository(ApplicationConfig).findOneBy({ guildId });
    if (appConfig?.channelId && appConfig.messageId) {
      messagesToDelete.push({
        source: 'Application button',
        channelId: appConfig.channelId,
        messageId: appConfig.messageId,
      });
    }

    // Bait channel warning
    const baitConfig = await AppDataSource.getRepository(BaitChannelConfig).findOneBy({ guildId });
    if (baitConfig?.channelId && baitConfig.channelMessageId) {
      messagesToDelete.push({
        source: 'Bait warning',
        channelId: baitConfig.channelId,
        messageId: baitConfig.channelMessageId,
      });
    }

    // Rules message
    const rulesConfig = await AppDataSource.getRepository(RulesConfig).findOneBy({ guildId });
    if (rulesConfig?.channelId && rulesConfig.messageId) {
      messagesToDelete.push({
        source: 'Rules message',
        channelId: rulesConfig.channelId,
        messageId: rulesConfig.messageId,
      });
    }

    // Archived ticket config message
    const archTicketConfig = await AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId });
    if (archTicketConfig?.channelId && archTicketConfig.messageId) {
      messagesToDelete.push({
        source: 'Ticket archive',
        channelId: archTicketConfig.channelId,
        messageId: archTicketConfig.messageId,
      });
    }

    // Archived application config message
    const archAppConfig = await AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({ guildId });
    if (archAppConfig?.channelId && archAppConfig.messageId) {
      messagesToDelete.push({
        source: 'App archive',
        channelId: archAppConfig.channelId,
        messageId: archAppConfig.messageId,
      });
    }

    // Reaction role menu messages (can be multiple)
    const reactionMenus = await AppDataSource.getRepository(ReactionRoleMenu).find({ where: { guildId } });
    for (const menu of reactionMenus) {
      if (menu.channelId && menu.messageId) {
        messagesToDelete.push({
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

  // Delete each message
  for (const { source, channelId, messageId } of messagesToDelete) {
    const success = await deleteMessage(client, channelId, messageId);
    if (success) {
      result.deleted++;
      result.details.push(`Deleted: ${source}`);
    } else {
      result.failed++;
      result.details.push(`Failed: ${source}`);
    }
  }

  // Phase 1.5: Delete forum threads created by Cogworks (archived tickets, applications, memory items)
  try {
    // Archived ticket threads
    const archTicketConfig = await AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId });
    if (archTicketConfig?.channelId) {
      const archivedTickets = await AppDataSource.getRepository(ArchivedTicket).find({ where: { guildId } });
      const forumChannel = (await client.channels
        .fetch(archTicketConfig.channelId)
        .catch(() => null)) as ForumChannel | null;
      if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
        for (const entry of archivedTickets) {
          if (!entry.messageId) continue;
          try {
            const thread = await forumChannel.threads.fetch(entry.messageId).catch(() => null);
            if (thread) {
              await thread.delete('Bot reset cleanup');
              result.deleted++;
            }
          } catch {
            /* thread already gone */
          }
        }
      }
    }

    // Archived application threads
    const archAppConfig = await AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({ guildId });
    if (archAppConfig?.channelId) {
      const archivedApps = await AppDataSource.getRepository(ArchivedApplication).find({ where: { guildId } });
      const forumChannel = (await client.channels
        .fetch(archAppConfig.channelId)
        .catch(() => null)) as ForumChannel | null;
      if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
        for (const entry of archivedApps) {
          if (!entry.messageId) continue;
          try {
            const thread = await forumChannel.threads.fetch(entry.messageId).catch(() => null);
            if (thread) {
              await thread.delete('Bot reset cleanup');
              result.deleted++;
            }
          } catch {
            /* thread already gone */
          }
        }
      }
    }

    // Memory item threads
    const memoryConfigs = await AppDataSource.getRepository(MemoryConfig).find({
      where: { guildId },
    });
    for (const memConfig of memoryConfigs) {
      if (!memConfig.forumChannelId) continue;
      const memoryItems = await AppDataSource.getRepository(MemoryItem).find({
        where: { guildId, memoryConfigId: memConfig.id },
      });
      const forumChannel = (await client.channels
        .fetch(memConfig.forumChannelId)
        .catch(() => null)) as ForumChannel | null;
      if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
        for (const item of memoryItems) {
          if (!item.threadId) continue;
          try {
            const thread = await forumChannel.threads.fetch(item.threadId).catch(() => null);
            if (thread) {
              await thread.delete('Bot reset cleanup');
              result.deleted++;
            }
          } catch {
            /* thread already gone */
          }
        }
      }
    }
  } catch (error) {
    enhancedLogger.warn('Forum thread cleanup partially failed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Phase 2: Use Discord's guild message search API to find ALL bot messages
  // This catches messages not tracked in config (old wizard embeds, dev-suite, etc.)
  // Endpoint: GET /guilds/{guild_id}/messages/search?author_id={bot_id}
  try {
    const botId = client.user?.id;
    if (botId) {
      const rest = client.rest;
      let offset = 0;
      const limit = 25; // Discord max per search request
      let hasMore = true;

      while (hasMore) {
        try {
          const searchResult = (await rest.get(
            `/guilds/${guildId}/messages/search?author_id=${botId}&sort_by=timestamp&limit=${limit}&offset=${offset}`,
          )) as any;

          const messages = searchResult?.messages || [];
          if (messages.length === 0) {
            hasMore = false;
            break;
          }

          for (const messageGroup of messages) {
            // Search API returns arrays of message objects (each "hit" is an array with context)
            const msg = Array.isArray(messageGroup) ? messageGroup[0] : messageGroup;
            if (!msg?.id || !msg?.channel_id) continue;

            // Skip messages we already deleted in Phase 1
            if (messagesToDelete.some(m => m.messageId === msg.id)) continue;

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
              // Message may be in an inaccessible channel or already deleted
            }
          }

          offset += limit;
          // Safety: don't scan more than 200 messages (8 pages)
          if (offset >= 200) hasMore = false;
        } catch {
          // Search API may not be available (preview feature) — fall back to channel scan
          hasMore = false;

          // Fallback: scan accessible channels for recent bot messages
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            // Scan text channels
            const channels = guild.channels.cache.filter(ch => ch.isTextBased() && !ch.isThread());
            for (const [, channel] of channels) {
              try {
                const messages = await (channel as TextChannel).messages.fetch({
                  limit: 50,
                });
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

            // Scan forum channels — messages live inside threads (forum posts)
            const forumChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildForum);
            for (const [, forum] of forumChannels) {
              try {
                // Fetch active threads in the forum
                const threads = await (forum as any).threads.fetchActive();
                for (const [, thread] of threads.threads) {
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
                // Also fetch archived threads
                const archived = await (forum as any).threads.fetchArchived();
                for (const [, thread] of archived.threads) {
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
              } catch {
                /* can't access forum */
              }
            }
          }
        }
      }
    }
  } catch {
    // Phase 2 is best-effort — don't fail the reset if search fails
  }

  enhancedLogger.info('Guild message cleanup complete', LogCategory.COMMAND_EXECUTION, {
    guildId,
    deleted: result.deleted,
    failed: result.failed,
  });

  return result;
}
