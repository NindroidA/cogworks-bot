import type {
  ChatInputCommandInteraction,
  ForumChannel,
  MessageComponentInteraction,
  ThreadChannel,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
  createRateLimitKey,
  E,
  enhancedLogger,
  healthMonitor,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';
import {
  createDefaultSelectionState,
  runTagSelectionCollector,
  type TagSelectionState,
} from './tagSelection';

const tl = lang.memory;
const memoryConfigRepo = AppDataSource.getRepository(MemoryConfig);
const memoryTagRepo = AppDataSource.getRepository(MemoryTag);
const memoryItemRepo = AppDataSource.getRepository(MemoryItem);

export const memoryUpdateTagsHandler = async (interaction: ChatInputCommandInteraction) => {
  const startTime = Date.now();
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-update-tags');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
  if (!rateCheck.allowed) {
    await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
    healthMonitor.recordCommand('memory update-tags', Date.now() - startTime, true);
    return;
  }

  const threadId = interaction.options.getString('thread', true);

  // Find memory item
  const memoryItem = await memoryItemRepo.findOneBy({ guildId, threadId });
  if (!memoryItem) {
    await interaction.reply({
      content: `${E.error} ${tl.quickUpdate.itemNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Resolve config from memory item's memoryConfigId
  const config = await memoryConfigRepo.findOneBy({ guildId, id: memoryItem.memoryConfigId });
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.errors.notConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Get available tags scoped by memoryConfigId
  const categoryTags = await memoryTagRepo.find({
    where: { guildId, memoryConfigId: memoryItem.memoryConfigId, tagType: 'category' },
  });
  const statusTags = await memoryTagRepo.find({
    where: { guildId, memoryConfigId: memoryItem.memoryConfigId, tagType: 'status' },
  });

  if (categoryTags.length === 0 || statusTags.length === 0) {
    await interaction.reply({
      content: `${E.error} ${tl.add.noTagsConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Initialize state with current item tags
  const currentStatusTag = statusTags.find(t => t.name === memoryItem.status);
  const selectionState: TagSelectionState = currentStatusTag
    ? {
        categoryId: null,
        categoryName: null,
        statusId: currentStatusTag.id.toString(),
        statusName: currentStatusTag.emoji
          ? `${currentStatusTag.emoji} ${currentStatusTag.name}`
          : currentStatusTag.name,
      }
    : createDefaultSelectionState(statusTags);

  await runTagSelectionCollector(
    interaction,
    categoryTags,
    statusTags,
    selectionState,
    {
      prefix: 'memory_update_tags',
      title: `${E.memory} Update Tags`,
      description: `Updating tags for: **${memoryItem.title}**`,
    },
    async (i: MessageComponentInteraction) => {
      await applyTagUpdate(
        i,
        selectionState,
        guildId,
        config.forumChannelId,
        threadId,
        memoryItem,
        startTime,
      );
    },
  );
};

async function applyTagUpdate(
  interaction: MessageComponentInteraction,
  selectionState: TagSelectionState,
  guildId: string,
  forumChannelId: string,
  threadId: string,
  memoryItem: MemoryItem,
  startTime: number,
) {
  await interaction.editReply({ embeds: [], components: [] });

  try {
    const forum = (await interaction.guild!.channels.fetch(forumChannelId)) as ForumChannel;
    if (!forum) {
      await interaction.editReply({ content: `${E.error} ${tl.errors.forumNotFound}` });
      return;
    }

    let thread: ThreadChannel | null = null;
    try {
      thread = (await interaction.guild!.channels.fetch(threadId)) as ThreadChannel;
    } catch {
      await interaction.editReply({ content: `${E.error} ${tl.quickUpdate.threadNotFound}` });
      return;
    }

    const categoryTag = selectionState.categoryId
      ? await memoryTagRepo.findOneBy({
          id: parseInt(selectionState.categoryId, 10),
          guildId,
        })
      : null;
    const statusTag = selectionState.statusId
      ? await memoryTagRepo.findOneBy({
          id: parseInt(selectionState.statusId, 10),
          guildId,
        })
      : null;

    // Build new tag list
    const appliedTags: string[] = [];
    if (categoryTag?.discordTagId) appliedTags.push(categoryTag.discordTagId);
    if (statusTag?.discordTagId) appliedTags.push(statusTag.discordTagId);

    // Update forum thread tags
    await thread.edit({ appliedTags });

    // Update database status
    if (statusTag) {
      memoryItem.status = statusTag.name;
      await memoryItemRepo.save(memoryItem);
    }

    await interaction.editReply({
      content: `${E.success} ${tl.quickUpdate.tagsSuccess} \u2014 <#${threadId}>`,
    });

    healthMonitor.recordCommand('memory update-tags', Date.now() - startTime, false);
  } catch (error) {
    enhancedLogger.error(
      `Memory update-tags error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({ content: `${E.error} ${tl.quickUpdate.tagsError}` });
    healthMonitor.recordCommand('memory update-tags', Date.now() - startTime, true);
  }
}
