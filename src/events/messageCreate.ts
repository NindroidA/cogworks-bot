import type { Client, Message } from 'discord.js';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';

export default {
  name: 'messageCreate',
  async execute(message: Message, client: Client) {
    if (!message.guild) return;

    // Get bait channel manager from client
    const { baitChannelManager } = client as ExtendedClient;
    if (!baitChannelManager) {
      enhancedLogger.debug('BaitChannelManager not available on client', LogCategory.SYSTEM);
      return;
    }

    // Track all messages for activity monitoring
    await baitChannelManager.trackMessage(message);

    // Handle bait channel
    await baitChannelManager.handleMessage(message);
  },
};
