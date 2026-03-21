import type { Message } from 'discord.js';
import { Ticket } from '../typeorm/entities/ticket/Ticket';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { lazyRepo } from '../utils/database/lazyRepo';

const ticketRepo = lazyRepo(Ticket);

export default {
  name: 'messageCreate',
  async execute(message: Message, client: ExtendedClient) {
    if (!message.guild) return;
    if (message.author.bot) return;

    // Get bait channel manager from client
    const { baitChannelManager } = client;
    if (!baitChannelManager) {
      enhancedLogger.debug('BaitChannelManager not available on client', LogCategory.SYSTEM);
      return;
    }

    // Track all messages for activity monitoring
    await baitChannelManager.trackMessage(message);

    // Handle bait channel
    await baitChannelManager.handleMessage(message);

    // Update lastActivityAt for ticket channels (lightweight update)
    try {
      await ticketRepo
        .createQueryBuilder()
        .update(Ticket)
        .set({ lastActivityAt: new Date() })
        .where('guildId = :guildId', { guildId: message.guild.id })
        .andWhere('channelId = :channelId', { channelId: message.channelId })
        .andWhere('status != :closed', { closed: 'closed' })
        .execute();
    } catch {
      // Silently fail — this is a non-critical update
    }
  },
};
