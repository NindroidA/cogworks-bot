import type { ChatInputCommandInteraction, ThreadChannel } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
  Colors,
  E,
  enhancedLogger,
  guardAdminRateLimit,
  healthMonitor,
  LogCategory,
  lang,
  RateLimits,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.memory;
const memoryConfigRepo = lazyRepo(MemoryConfig);
const memoryTagRepo = lazyRepo(MemoryTag);
const memoryItemRepo = lazyRepo(MemoryItem);

export async function memoryUpdateStatusHandler(interaction: ChatInputCommandInteraction) {
  const startTime = Date.now();
  const guard = await guardAdminRateLimit(interaction, {
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
    await interaction.reply({
      content: `${E.error} ${tl.quickUpdate.itemNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Resolve config from memory item's memoryConfigId
  const config = await memoryConfigRepo.findOneBy({
    guildId,
    id: memoryItem.memoryConfigId,
  });
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.errors.notConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Find the new status tag
  const newStatusTag = await memoryTagRepo.findOneBy({
    id: parseInt(statusTagId, 10),
    guildId,
    memoryConfigId: memoryItem.memoryConfigId,
    tagType: 'status',
  });
  if (!newStatusTag) {
    await interaction.reply({
      content: `${E.error} ${tl.quickUpdate.itemNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
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
      await interaction.editReply({
        content: `${E.error} ${tl.quickUpdate.threadNotFound}`,
      });
      return;
    }

    let thread: ThreadChannel | null = null;
    try {
      thread = (await interaction.guild!.channels.fetch(threadId)) as ThreadChannel;
    } catch {
      await interaction.editReply({
        content: `${E.error} ${tl.quickUpdate.threadNotFound}`,
      });
      return;
    }

    const currentTags = thread.appliedTags || [];
    const newTags = currentTags.filter(tagId => tagId !== oldStatusTag?.discordTagId);
    if (newStatusTag.discordTagId) {
      newTags.push(newStatusTag.discordTagId);
    }
    await thread.edit({ appliedTags: newTags });

    // Update database
    const oldStatus = memoryItem.status;
    memoryItem.status = newStatusTag.name;
    await memoryItemRepo.save(memoryItem);

    const willClose = newStatusTag.name === 'Completed';

    await interaction.editReply({
      content: `${E.success} ${tl.quickUpdate.statusSuccess}\n**${oldStatus}** \u2192 **${newStatusTag.emoji ? `${newStatusTag.emoji} ` : ''}${newStatusTag.name}** \u2014 <#${threadId}>`,
    });

    if (willClose) {
      try {
        const closeEmbed = new EmbedBuilder()
          .setTitle(`${E.memory} ${tl.closeNotice.title}`)
          .setDescription(tl.closeNotice.description.replace('{0}', `<@${interaction.user.id}>`))
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
    enhancedLogger.error(
      `Memory update-status error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      {
        guildId,
      },
    );
    await interaction.editReply({
      content: `${E.error} ${tl.quickUpdate.statusError}`,
    });
    healthMonitor.recordCommand('memory update-status', Date.now() - startTime, true);
  }
}
