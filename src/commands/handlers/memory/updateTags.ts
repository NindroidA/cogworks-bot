import type { ChatInputCommandInteraction, ForumChannel, MessageComponentInteraction, ThreadChannel } from 'discord.js';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
  E,
  enhancedLogger,
  guardFeatureRateLimit,
  healthMonitor,
  LogCategory,
  lang,
  logHandlerError,
  RateLimits,
  replyEphemeralError,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { editMemoryThreadTags } from '../../../utils/memory/threadHelpers';
import { createDefaultSelectionState, runTagSelectionCollector, type TagSelectionState } from './tagSelection';

const tl = lang.memory;
const memoryConfigRepo = lazyRepo(MemoryConfig);
const memoryTagRepo = lazyRepo(MemoryTag);
const memoryItemRepo = lazyRepo(MemoryItem);

export async function memoryUpdateTagsHandler(interaction: ChatInputCommandInteraction) {
  const startTime = Date.now();
  const guard = await guardFeatureRateLimit(interaction, 'memory', 'manage', {
    action: 'memory-update-tags',
    limit: RateLimits.MEMORY_OPERATION,
    scope: 'userGuild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;

  const threadId = interaction.options.getString('thread', true);

  // Find memory item
  const memoryItem = await memoryItemRepo.findOneBy({ guildId, threadId });
  if (!memoryItem) {
    await replyEphemeralError(interaction, tl.quickUpdate.itemNotFound);
    return;
  }

  // Resolve config from memory item's memoryConfigId
  const config = await memoryConfigRepo.findOneBy({
    guildId,
    id: memoryItem.memoryConfigId,
  });
  if (!config) {
    await replyEphemeralError(interaction, tl.errors.notConfigured);
    return;
  }

  // Get available tags scoped by memoryConfigId
  const categoryTags = await memoryTagRepo.find({
    where: {
      guildId,
      memoryConfigId: memoryItem.memoryConfigId,
      tagType: 'category',
    },
  });
  const statusTags = await memoryTagRepo.find({
    where: {
      guildId,
      memoryConfigId: memoryItem.memoryConfigId,
      tagType: 'status',
    },
  });

  if (categoryTags.length === 0 || statusTags.length === 0) {
    await replyEphemeralError(interaction, tl.add.noTagsConfigured);
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
      await applyTagUpdate(i, selectionState, guildId, config.forumChannelId, threadId, memoryItem, startTime);
    },
  );
}

async function applyTagUpdate(
  interaction: MessageComponentInteraction,
  selectionState: TagSelectionState,
  guildId: string,
  forumChannelId: string,
  threadId: string,
  memoryItem: MemoryItem,
  startTime: number,
) {
  try {
    // The Continue click arrives unacknowledged (add/capture open a modal from
    // it), so answer it before anything else — editReply alone threw
    // InteractionNotReplied and every update-tags run failed.
    await interaction.update({
      content: `${E.loading} ${tl.channelPicker.processing}`,
      embeds: [],
      components: [],
    });

    const forum = (await interaction.guild!.channels.fetch(forumChannelId)) as ForumChannel;
    if (!forum) {
      await showTagUpdateError(interaction, tl.errors.forumNotFound);
      return;
    }

    let thread: ThreadChannel | null = null;
    try {
      thread = (await interaction.guild!.channels.fetch(threadId)) as ThreadChannel;
    } catch {
      await showTagUpdateError(interaction, tl.quickUpdate.threadNotFound);
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

    // Accumulate, don't replace: preserve any tags on the thread that aren't
    // bot-managed memory tags (e.g. manually-added forum tags), and swap out
    // only the managed category/status tags for the newly-selected ones.
    const managedTagIds = new Set(
      (await memoryTagRepo.find({ where: { guildId } })).map(t => t.discordTagId).filter((id): id is string => !!id),
    );
    const preserved = (thread.appliedTags || []).filter(id => !managedTagIds.has(id));
    const appliedTags = [...preserved];
    if (categoryTag?.discordTagId) appliedTags.push(categoryTag.discordTagId);
    if (statusTag?.discordTagId) appliedTags.push(statusTag.discordTagId);

    // Update forum thread tags (Discord caps appliedTags at 5). An archived
    // (e.g. Completed) thread is unarchived in the same request; only a move
    // away from Completed unlocks it, and otherwise it is archived again below.
    const { wasArchived, reopened } = await editMemoryThreadTags(thread, appliedTags.slice(0, 5), {
      from: memoryItem.status,
      to: statusTag?.name ?? memoryItem.status,
    });

    // Update database status
    if (statusTag) {
      memoryItem.status = statusTag.name;
      await memoryItemRepo.save(memoryItem);
    }

    await interaction.editReply({
      content: `${E.success} ${tl.quickUpdate.tagsSuccess} \u2014 <#${threadId}>`,
    });

    if (wasArchived && !reopened) {
      await thread.setArchived(true).catch(() => {
        enhancedLogger.warn('Could not re-archive memory thread after a tag update', LogCategory.COMMAND_EXECUTION, {
          guildId,
          threadId,
        });
      });
    }

    healthMonitor.recordCommand('memory update-tags', Date.now() - startTime, false);
  } catch (error) {
    logHandlerError('Memory update-tags', error, { guildId });
    await showTagUpdateError(interaction, tl.quickUpdate.tagsError);
    healthMonitor.recordCommand('memory update-tags', Date.now() - startTime, true);
  }
}

/** Once the click is acknowledged, an error replaces the "Processing…" screen instead of stacking a follow-up. */
async function showTagUpdateError(interaction: MessageComponentInteraction, message: string) {
  if (!interaction.replied) {
    await replyEphemeralError(interaction, message);
    return;
  }
  await interaction
    .editReply({ content: `${E.error} ${message}` })
    .catch(() => replyEphemeralError(interaction, message));
}
