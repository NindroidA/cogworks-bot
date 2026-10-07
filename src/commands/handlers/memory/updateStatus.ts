import type { ChatInputCommandInteraction, ThreadChannel } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
  Colors,
  E,
  enhancedLogger,
  fmt,
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

const tl = lang.memory;
const memoryConfigRepo = lazyRepo(MemoryConfig);
const memoryTagRepo = lazyRepo(MemoryTag);
const memoryItemRepo = lazyRepo(MemoryItem);

export async function memoryUpdateStatusHandler(interaction: ChatInputCommandInteraction) {
  const startTime = Date.now();
  const guard = await guardFeatureRateLimit(interaction, 'memory', 'manage', {
    action: 'memory-update-status',
    limit: RateLimits.MEMORY_OPERATION,
    scope: 'userGuild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;

  const threadId = interaction.options.getString('thread', true);
  const statusTagId = interaction.options.getString('status', true);

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

  // Find the new status tag
  const newStatusTag = await resolveStatusTag(guildId, memoryItem.memoryConfigId, statusTagId);
  if (!newStatusTag) {
    await replyEphemeralError(interaction, tl.tags.edit.tagNotFound);
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    // Get all status tags to find the old one's discordTagId
    const statusTags = await memoryTagRepo.find({
      where: {
        guildId,
        memoryConfigId: memoryItem.memoryConfigId,
        tagType: 'status',
      },
    });
    const oldStatusTag = statusTags.find(t => t.name === memoryItem.status);

    // Update forum thread tags
    const forum = await interaction.guild!.channels.fetch(config.forumChannelId);
    if (!forum) {
      await replyEphemeralError(interaction, tl.quickUpdate.threadNotFound);
      return;
    }

    let thread: ThreadChannel | null = null;
    try {
      thread = (await interaction.guild!.channels.fetch(threadId)) as ThreadChannel;
    } catch {
      await replyEphemeralError(interaction, tl.quickUpdate.threadNotFound);
      return;
    }

    const currentTags = thread.appliedTags || [];
    const newTags = currentTags.filter(tagId => tagId !== oldStatusTag?.discordTagId);
    if (newStatusTag.discordTagId) {
      newTags.push(newStatusTag.discordTagId);
    }
    const oldStatus = memoryItem.status;
    const willClose = newStatusTag.name === 'Completed';
    // Completed items are locked + archived: unarchive in the same edit (and
    // unlock when reopening), or Discord rejects the tag change with 50083.
    await editMemoryThreadTags(thread, newTags, { from: oldStatus, to: newStatusTag.name });

    // Update database
    memoryItem.status = newStatusTag.name;
    await memoryItemRepo.save(memoryItem);

    await interaction.editReply({
      content: `${E.success} ${tl.quickUpdate.statusSuccess}\n**${oldStatus}** \u2192 **${newStatusTag.emoji ? `${newStatusTag.emoji} ` : ''}${newStatusTag.name}** \u2014 <#${threadId}>`,
    });

    if (willClose) {
      try {
        const closeEmbed = new EmbedBuilder()
          .setTitle(`${E.memory} ${tl.closeNotice.title}`)
          .setDescription(fmt(tl.closeNotice.description, { user: `<@${interaction.user.id}>` }))
          .setColor(Colors.status.neutral);

        await thread.send({ embeds: [closeEmbed] });
      } catch {
        // Non-critical
      }

      try {
        await thread.setLocked(true);
        await thread.setArchived(true);
      } catch {
        enhancedLogger.warn('Could not lock/archive completed memory thread', LogCategory.COMMAND_EXECUTION, {
          guildId,
          threadId,
        });
      }
    }

    healthMonitor.recordCommand('memory update-status', Date.now() - startTime, false);
  } catch (error) {
    logHandlerError('Memory update-status', error, { guildId });
    await replyEphemeralError(interaction, tl.quickUpdate.statusError);
    healthMonitor.recordCommand('memory update-status', Date.now() - startTime, true);
  }
}

/**
 * Resolve the picked status within the item's own memory config. Autocomplete
 * may hand over the id of a same-named status from another forum (each forum
 * has its own copy of the defaults), so a miss is re-resolved by name.
 */
async function resolveStatusTag(guildId: string, memoryConfigId: number, statusTagId: string) {
  const id = Number.parseInt(statusTagId, 10);
  if (Number.isNaN(id)) return null;

  const exact = await memoryTagRepo.findOneBy({ id, guildId, memoryConfigId, tagType: 'status' });
  if (exact) return exact;

  const picked = await memoryTagRepo.findOneBy({ id, guildId, tagType: 'status' });
  if (!picked) return null;
  return memoryTagRepo.findOneBy({ guildId, memoryConfigId, tagType: 'status', name: picked.name });
}
