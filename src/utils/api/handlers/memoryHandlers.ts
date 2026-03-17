import type { Client, ForumChannel } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const memoryConfigRepo = AppDataSource.getRepository(MemoryConfig);
const memoryItemRepo = AppDataSource.getRepository(MemoryItem);
const memoryTagRepo = AppDataSource.getRepository(MemoryTag);

export function registerMemoryHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/memory/create
  routes.set('POST /memory/create', async (guildId, body) => {
    const memoryConfigId = body.memoryConfigId as number;
    const title = body.title as string;
    const description = body.description as string;
    const createdBy = body.createdBy as string;
    if (!memoryConfigId || !title || !createdBy) {
      return { error: 'memoryConfigId, title, and createdBy are required' };
    }

    const config = await memoryConfigRepo.findOneBy({
      guildId,
      id: memoryConfigId,
    });
    if (!config) return { error: 'Memory config not found' };

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { error: 'Guild not found' };

    const forum = (await guild.channels
      .fetch(config.forumChannelId)
      .catch(() => null)) as ForumChannel | null;
    if (!forum) return { error: 'Memory forum channel not found' };

    // Build applied tags
    const appliedTags: string[] = [];
    const categoryTagId = body.categoryTagId as number | undefined;
    if (categoryTagId) {
      const tag = await memoryTagRepo.findOneBy({
        id: categoryTagId,
        guildId,
        memoryConfigId,
      });
      if (tag?.discordTagId) appliedTags.push(tag.discordTagId);
    }

    // Default to "Open" status tag
    const statusTag = await memoryTagRepo.findOne({
      where: { guildId, memoryConfigId, tagType: 'status', name: 'Open' },
    });
    if (statusTag?.discordTagId) appliedTags.push(statusTag.discordTagId);

    const content = description
      ? `**Description:**\n\n${description}\n\n-# Created via dashboard`
      : '-# Created via dashboard';

    const thread = await forum.threads.create({
      name: title,
      message: { content },
      appliedTags,
    });

    const memoryItem = memoryItemRepo.create({
      guildId,
      memoryConfigId,
      threadId: thread.id,
      title,
      description: description || null,
      status: statusTag?.name || 'Open',
      createdBy,
    });
    await memoryItemRepo.save(memoryItem);

    await writeAuditLog(guildId, 'memory.create', body.triggeredBy as string, {
      threadId: thread.id,
      itemId: memoryItem.id,
    });
    return { success: true, threadId: thread.id, itemId: memoryItem.id };
  });
}
