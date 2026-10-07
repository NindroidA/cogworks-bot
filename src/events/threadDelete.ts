/**
 * Thread Delete Event Handler
 *
 * Cleans up memory items when their backing forum thread is deleted.
 * Without the thread, the memory item is orphaned and should be removed.
 */

import type { AnyThreadChannel } from 'discord.js';
import { cleanThreadRefs } from '../utils/cleanup/refCleaners';

export default {
  name: 'threadDelete',
  async execute(thread: AnyThreadChannel) {
    if (!thread.guild) return;

    await cleanThreadRefs(thread.guildId, thread.id);
  },
};
