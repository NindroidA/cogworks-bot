import type { Client, ForumChannel } from 'discord.js';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import { lazyRepo } from '../../database/lazyRepo';
import { buildStarterContent, MEMORY_TITLE_MAX } from '../../memory/threadHelpers';
import { ApiError } from '../apiError';
import { optionalNumber, optionalString, requireNumber, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditAction } from './auditHelper';

const memoryConfigRepo = lazyRepo(MemoryConfig);
const memoryItemRepo = lazyRepo(MemoryItem);
const memoryTagRepo = lazyRepo(MemoryTag);

export function registerMemoryHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/memory/create
  routes.set('POST /memory/create', async (guildId, body) => {
    const memoryConfigId = requireNumber(body, 'memoryConfigId');
    const title = requireString(body, 'title');
    const description = optionalString(body, 'description');
    const createdBy = requireString(body, 'createdBy');
    // The title becomes the thread name, which Discord caps at 100: reject it
    // here (400) instead of failing in threads.create (500).
    if (title.length > MEMORY_TITLE_MAX) {
      throw ApiError.badRequest(`title must be at most ${MEMORY_TITLE_MAX} characters`);
    }

    const config = await memoryConfigRepo.findOneBy({
      guildId,
      id: memoryConfigId,
    });
    if (!config) throw ApiError.notFound('Memory config not found');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');

    const forum = (await guild.channels.fetch(config.forumChannelId).catch(() => null)) as ForumChannel | null;
    if (!forum) throw ApiError.notFound('Memory forum channel not found');

    // Build applied tags
    const appliedTags: string[] = [];
    const categoryTagId = optionalNumber(body, 'categoryTagId');
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

    // Clamped to the 2000-char starter message, with a visible notice when cut
    const content = buildStarterContent(description ?? '', '-# Created via dashboard');

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

    await writeAuditAction(guildId, body, 'memory.create', {
      threadId: thread.id,
      itemId: memoryItem.id,
    });
    return { success: true, threadId: thread.id, itemId: memoryItem.id };
  });
}
