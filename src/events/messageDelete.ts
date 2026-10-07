import type { Message, PartialMessage } from 'discord.js';
import type { ExtendedClient } from '../types/ExtendedClient';
import { cleanMessageRefs } from '../utils/cleanup/refCleaners';

export default {
  name: 'messageDelete',
  async execute(message: Message | PartialMessage, client: ExtendedClient) {
    if (!message.guild) return;

    const guildId = message.guild.id;
    const messageId = message.id;

    // Performance guard: only bot-authored messages can be tracked config messages.
    // If author is known and is NOT the bot, skip all DB queries.
    // If author is null (partial message), we still need to check DB.
    if (message.author && message.author.id !== client.user?.id) return;

    const { baitChannelManager } = client;
    if (baitChannelManager) {
      await baitChannelManager.handleMessageDelete(messageId, guildId);
    }

    await cleanMessageRefs(guildId, messageId);
  },
};
