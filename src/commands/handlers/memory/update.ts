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
import { AppDataSource } from '../../../typeorm';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
  Colors,
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

const tl = lang.memory;
const memoryConfigRepo = AppDataSource.getRepository(MemoryConfig);
const memoryTagRepo = AppDataSource.getRepository(MemoryTag);
const memoryItemRepo = AppDataSource.getRepository(MemoryItem);

export const memoryUpdateHandler = async (interaction: ChatInputCommandInteraction) => {
  const startTime = Date.now();
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  // Rate limit check
  const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-update');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
  if (!rateCheck.allowed) {
    await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
    healthMonitor.recordCommand('memory update', Date.now() - startTime, true);
    return;
  }

  const channel = interaction.channel;

  // Check if memory system is configured
  const config = await memoryConfigRepo.findOneBy({ guildId });
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.errors.notConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check if we're in a thread within the memory forum
  if (!channel || channel.type !== ChannelType.PublicThread) {
    await interaction.reply({
      content: `${E.error} ${tl.update.notAThread}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const threadChannel = channel as ThreadChannel;

  // Check if the parent is the memory forum
  if (threadChannel.parentId !== config.forumChannelId) {
    await interaction.reply({
      content: `${E.error} ${tl.update.notInForum}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Get the memory item from database
  const memoryItem = await memoryItemRepo.findOneBy({ guildId, threadId: threadChannel.id });
  if (!memoryItem) {
    await interaction.reply({
      content: `${E.error} ${tl.update.itemNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Get available status tags
  const statusTags = await memoryTagRepo.find({ where: { guildId, tagType: 'status' } });

  if (statusTags.length === 0) {
    await interaction.reply({
      content: `${E.error} No status tags configured. Run /memory-setup first.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Find current status tag
  const currentStatusTag = statusTags.find(t => t.name === memoryItem.status);

  const statusOptions = statusTags.map(tag => ({
    label: tag.name,
    value: tag.id.toString(),
    emoji: tag.emoji || undefined,
    default: tag.name === memoryItem.status,
  }));

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

  const statusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_update_status')
      .setPlaceholder(tl.update.selectStatus)
      .addOptions(statusOptions),
  );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('memory_update_confirm')
      .setLabel('Update')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('memory_update_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const response = await interaction.reply({
    embeds: [buildEmbed()],
    components: [statusSelect, buttonRow],
    flags: [MessageFlags.Ephemeral],
  });

  const collector = response.createMessageComponentCollector({
    time: 120000,
  });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: lang.errors.notYourInteraction, flags: [MessageFlags.Ephemeral] });
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
        // Get current thread tags
        const currentTags = threadChannel.appliedTags || [];

        // Find and remove old status tag, add new one
        const oldStatusTag = statusTags.find(t => t.name === memoryItem.status);
        const newTags = currentTags.filter(tagId => tagId !== oldStatusTag?.discordTagId);
        if (newStatusTag.discordTagId) {
          newTags.push(newStatusTag.discordTagId);
        }

        // Update thread tags
        await threadChannel.edit({ appliedTags: newTags });

        // Update database
        memoryItem.status = newStatusTag.name;
        await memoryItemRepo.save(memoryItem);

        // Send success reply FIRST (while thread is still open)
        const willClose = newStatusTag.name === 'Completed';
        const closedMessage = willClose ? '\nThread has been closed.' : '';

        await interaction.editReply({
          content: `${E.success} ${tl.update.success}\n**${selectionState.oldStatusName}** \u2192 **${newStatusTag.emoji ? `${newStatusTag.emoji} ` : ''}${newStatusTag.name}**${closedMessage}`,
          embeds: [],
          components: [],
        });

        // THEN archive (reply already delivered)
        if (willClose) {
          try {
            await threadChannel.setArchived(true);
          } catch {
            enhancedLogger.warn(
              'Could not archive completed memory thread',
              LogCategory.COMMAND_EXECUTION,
              { guildId, threadId: threadChannel.id },
            );
          }
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

        // Rebuild components with updated state
        const updatedStatusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('memory_update_status')
            .setPlaceholder(tl.update.selectStatus)
            .addOptions(
              statusTags.map(tag => ({
                label: tag.name,
                value: tag.id.toString(),
                emoji: tag.emoji || undefined,
                default: tag.id.toString() === selectionState.newStatusId,
              })),
            ),
        );

        await selectInteraction.update({
          embeds: [buildEmbed()],
          components: [updatedStatusSelect, buttonRow],
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
        .catch(() => {});
    }
  });
};
