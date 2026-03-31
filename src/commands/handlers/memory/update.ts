import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  type ThreadChannel,
} from 'discord.js';
import { MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import { Colors, E, enhancedLogger, guardAdminRateLimit, LogCategory, lang, RateLimits } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { resolveConfigFromThread } from './channelPicker';

const tl = lang.memory;
const memoryTagRepo = lazyRepo(MemoryTag);
const memoryItemRepo = lazyRepo(MemoryItem);

/** Validate the interaction context and load the memory item + status tags. */
async function validateUpdateContext(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.PublicThread) {
    await interaction.reply({
      content: `${E.error} ${tl.update.notAThread}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  const threadChannel = channel as ThreadChannel;

  const config = await resolveConfigFromThread(guildId, threadChannel.parentId);
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.update.notInForum}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  const memoryItem = await memoryItemRepo.findOneBy({
    guildId,
    threadId: threadChannel.id,
  });
  if (!memoryItem) {
    await interaction.reply({
      content: `${E.error} ${tl.update.itemNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  const statusTags = await memoryTagRepo.find({
    where: { guildId, memoryConfigId: config.id, tagType: 'status' },
  });

  if (statusTags.length === 0) {
    await interaction.reply({
      content: `${E.error} No status tags configured. Run /memory-setup first.`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  return { threadChannel, memoryItem, statusTags };
}

/** Build the status select menu for a given set of tags and current selection. */
function buildStatusSelectRow(statusTags: MemoryTag[], selectedId: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_update_status')
      .setPlaceholder(tl.update.selectStatus)
      .addOptions(
        statusTags.map(tag => ({
          label: tag.name,
          value: tag.id.toString(),
          emoji: tag.emoji || undefined,
          default: tag.id.toString() === selectedId,
        })),
      ),
  );
}

/** Build the confirm/cancel button row. */
function buildUpdateButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('memory_update_confirm').setLabel('Update').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('memory_update_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

/** Apply the status change: swap forum tags and update the DB record. */
async function applyStatusChange(
  threadChannel: ThreadChannel,
  memoryItem: MemoryItem,
  statusTags: MemoryTag[],
  newStatusTag: MemoryTag,
) {
  const currentTags = threadChannel.appliedTags || [];
  const oldStatusTag = statusTags.find(t => t.name === memoryItem.status);
  const newTags = currentTags.filter(tagId => tagId !== oldStatusTag?.discordTagId);
  if (newStatusTag.discordTagId) {
    newTags.push(newStatusTag.discordTagId);
  }

  await threadChannel.edit({ appliedTags: newTags });

  memoryItem.status = newStatusTag.name;
  await memoryItemRepo.save(memoryItem);
}

/** If the new status is "Completed", send a close notice and lock/archive the thread. */
async function handleCompletedStatus(threadChannel: ThreadChannel, userId: string, guildId: string) {
  try {
    const closeEmbed = new EmbedBuilder()
      .setTitle(`${E.memory} ${tl.closeNotice.title}`)
      .setDescription(tl.closeNotice.description.replace('{0}', `<@${userId}>`))
      .setColor(Colors.status.neutral);
    await threadChannel.send({ embeds: [closeEmbed] });
  } catch {
    // Non-critical — close notice is informational
  }

  try {
    await threadChannel.setLocked(true);
    await threadChannel.setArchived(true);
  } catch {
    enhancedLogger.warn('Could not lock/archive completed memory thread', LogCategory.COMMAND_EXECUTION, {
      guildId,
      threadId: threadChannel.id,
    });
  }
}

export async function memoryUpdateHandler(interaction: ChatInputCommandInteraction) {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'memory-update',
    limit: RateLimits.MEMORY_OPERATION,
    scope: 'userGuild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;

  // Validate context and load data
  const context = await validateUpdateContext(interaction);
  if (!context) return;
  const { threadChannel, memoryItem, statusTags } = context;

  // Find current status tag
  const currentStatusTag = statusTags.find(t => t.name === memoryItem.status);

  // Store selection state
  const selectionState = {
    newStatusId: currentStatusTag?.id.toString() || statusTags[0].id.toString(),
    newStatusName: currentStatusTag?.emoji
      ? `${currentStatusTag.emoji} ${currentStatusTag.name}`
      : currentStatusTag?.name || memoryItem.status,
    oldStatusName: memoryItem.status,
  };

  // Build embed showing current state
  const buildEmbed = () => {
    return new EmbedBuilder()
      .setTitle(`${E.memory} ${tl.update.title}`)
      .setDescription(`**Thread:** ${threadChannel.name}`)
      .setColor(Colors.brand.primary)
      .addFields(
        {
          name: 'Current Status',
          value: selectionState.oldStatusName,
          inline: true,
        },
        {
          name: 'New Status',
          value: selectionState.newStatusName,
          inline: true,
        },
      );
  };

  const buttonRow = buildUpdateButtonRow();

  const response = await interaction.reply({
    embeds: [buildEmbed()],
    components: [buildStatusSelectRow(statusTags, selectionState.newStatusId), buttonRow],
    flags: [MessageFlags.Ephemeral],
  });

  const collector = response.createMessageComponentCollector({
    time: 120000,
  });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({
        content: lang.errors.notYourInteraction,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (i.customId === 'memory_update_cancel') {
      collector.stop('cancelled');
      await i.update({
        content: lang.errors.cancelled,
        embeds: [],
        components: [],
      });
      return;
    }

    if (i.customId === 'memory_update_confirm') {
      collector.stop('confirmed');

      // Disable buttons immediately to prevent double-clicks
      await i.update({
        embeds: [buildEmbed()],
        components: [],
      });

      // Get the new status tag (include guildId for security)
      const newStatusTag = await memoryTagRepo.findOneBy({
        id: parseInt(selectionState.newStatusId, 10),
        guildId,
      });
      if (!newStatusTag) {
        await interaction.editReply({
          content: `${E.error} ${tl.update.error}`,
          embeds: [],
          components: [],
        });
        return;
      }

      try {
        await applyStatusChange(threadChannel, memoryItem, statusTags, newStatusTag);

        await interaction.editReply({
          content: `${E.success} ${tl.update.success}\n**${selectionState.oldStatusName}** → **${newStatusTag.emoji ? `${newStatusTag.emoji} ` : ''}${newStatusTag.name}**`,
          embeds: [],
          components: [],
        });

        if (newStatusTag.name === 'Completed') {
          await handleCompletedStatus(threadChannel, interaction.user.id, guildId);
        }
      } catch (error) {
        enhancedLogger.error(
          `Memory update error: ${error}`,
          error instanceof Error ? error : undefined,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
        await interaction.editReply({
          content: `${E.error} ${tl.update.error}`,
          embeds: [],
          components: [],
        });
      }
      return;
    }

    if (i.isStringSelectMenu()) {
      const selectInteraction = i as StringSelectMenuInteraction;

      if (selectInteraction.customId === 'memory_update_status') {
        const selectedTag = statusTags.find(t => t.id.toString() === selectInteraction.values[0]);
        selectionState.newStatusId = selectInteraction.values[0];
        selectionState.newStatusName = selectedTag?.emoji
          ? `${selectedTag.emoji} ${selectedTag.name}`
          : selectedTag?.name || 'Unknown';

        await selectInteraction.update({
          embeds: [buildEmbed()],
          components: [buildStatusSelectRow(statusTags, selectionState.newStatusId), buttonRow],
        });
      }
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') {
      interaction
        .editReply({
          content: lang.errors.timeout,
          embeds: [],
          components: [],
        })
        .catch(() => null);
    }
  });
}
