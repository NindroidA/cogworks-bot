import type { Message, PartialMessage, ReadonlyCollection, Snowflake } from 'discord.js';
import type { ExtendedClient } from '../types/ExtendedClient';
import { cleanMessageRefs } from '../utils/cleanup/refCleaners';

/**
 * A purge or bulk delete arrives as one messageDeleteBulk event and never as
 * per-message messageDelete events, so the config-message cleanup runs here
 * for each deleted message. Only the config cleaners run: a moderator's purge
 * must not cancel pending bait grace bans the way a user deleting their own
 * bait message does. Cached messages the bot didn't write are skipped before
 * any query, and messages run one at a time so a 100-message purge can't
 * flood the pool.
 */
export default {
  name: 'messageDeleteBulk',
  async execute(messages: ReadonlyCollection<Snowflake, Message | PartialMessage>, client: ExtendedClient) {
    for (const message of messages.values()) {
      if (!message.guild) continue;
      if (message.author && message.author.id !== client.user?.id) continue;
      await cleanMessageRefs(message.guild.id, message.id);
    }
  },
};
