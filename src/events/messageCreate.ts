import type { Message } from 'discord.js';
import { Ticket } from '../typeorm/entities/ticket/Ticket';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { activityTracker } from '../utils/analytics/activityTracker';
import { lazyRepo } from '../utils/database/lazyRepo';

const ticketRepo = lazyRepo(Ticket);

export default {
  name: 'messageCreate',
  async execute(message: Message, client: ExtendedClient) {
    if (!message.guild) return;
    if (message.author.bot) return;

    // Feed the analytics tracker. Done before bait/ticket work so a
    // downstream failure in either doesn't drop analytics counts. The call
    // is synchronous and in-memory — no DB hop, no latency tax on hot path.
    // Dev guild is skipped to match the existing join-tracking convention
    // in guildMemberAdd.ts so /insights on the dev server isn't polluted.
    if (!process.env.DEV_GUILD_ID || message.guild.id !== process.env.DEV_GUILD_ID) {
      // `name` is null for DMs but we've already guarded on message.guild
      // above; `'name' in channel` handles thread parents and voice text.
      const channelName = 'name' in message.channel && message.channel.name ? message.channel.name : 'unknown';
      activityTracker.recordMessage(message.guild.id, message.channelId, channelName, message.author.id);
    }

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

    // One UPDATE for the ticket channel: bump lastActivityAt always, and in
    // the SAME statement capture the first response from someone other than
    // the opener — the SLA subsystem's data source (slaChecker queries
    // firstResponseAt IS NULL; before v3.16.0 nothing in production ever wrote
    // it). For email-import tickets `createdBy` is the importing admin, NOT
    // the sender the ticket represents, so every Discord message there is a
    // staff response and the opener-exclusion is skipped. Merged into one
    // statement to keep the per-message hot path at a single round-trip; the
    // conditional CASE makes firstResponseAt a no-op for every message but the
    // genuine first response. Silent-fail like any non-critical hot-path write.
    try {
      const now = new Date();
      await ticketRepo
        .createQueryBuilder()
        .update(Ticket)
        .set({
          lastActivityAt: now,
          firstResponseAt: () =>
            'CASE WHEN firstResponseAt IS NULL AND (isEmailTicket = TRUE OR createdBy != :author) THEN :firstResponseNow ELSE firstResponseAt END',
        })
        .where('guildId = :guildId', { guildId: message.guild.id })
        .andWhere('channelId = :channelId', { channelId: message.channelId })
        .andWhere('status != :closed', { closed: 'closed' })
        .setParameters({ author: message.author.id, firstResponseNow: now })
        .execute();
    } catch {
      // Silently fail — this is a non-critical update
    }
  },
};
