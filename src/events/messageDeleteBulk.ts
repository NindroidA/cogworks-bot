import type { Message, PartialMessage, ReadonlyCollection, Snowflake } from 'discord.js';
import type { ExtendedClient } from '../types/ExtendedClient';
import messageDeleteEvent from './messageDelete';

/**
 * A purge or bulk delete arrives as one messageDeleteBulk event and never as
 * per-message messageDelete events, so the config-message cleanup runs here
 * for each deleted message. messageDelete returns before any query for a
 * cached message the bot didn't write, so a purge of chat costs nothing; the
 * messages run one at a time so a 100-message purge can't flood the pool.
 */
export default {
  name: 'messageDeleteBulk',
  async execute(messages: ReadonlyCollection<Snowflake, Message | PartialMessage>, client: ExtendedClient) {
    for (const message of messages.values()) {
      await messageDeleteEvent.execute(message, client);
    }
  },
};
