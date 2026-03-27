/**
 * Thread Delete Event Handler
 *
 * Cleans up memory items when their backing forum thread is deleted.
 * Without the thread, the memory item is orphaned and should be removed.
 */

import type { AnyThreadChannel } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { MemoryItem } from '../typeorm/entities/memory/MemoryItem';
import { enhancedLogger, LogCategory } from '../utils';

export default {
  name: 'threadDelete',
  async execute(thread: AnyThreadChannel) {
    if (!thread.guild) return;

    const guildId = thread.guildId;
    const threadId = thread.id;

    try {
      const repo = AppDataSource.getRepository(MemoryItem);
      const item = await repo.findOneBy({ guildId, threadId });
      if (!item) return;

      await repo.remove(item);
      enhancedLogger.info('Deleted MemoryItem for deleted thread', LogCategory.SYSTEM, {
        guildId,
        threadId,
        memoryTitle: item.title,
      });
    } catch (error) {
      enhancedLogger.error('Failed to clean up MemoryItem for deleted thread', error as Error, LogCategory.DATABASE, {
        guildId,
        threadId,
      });
    }
  },
};
