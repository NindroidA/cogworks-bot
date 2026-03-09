import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ForumChannel,
  type MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
  createRateLimitKey,
  E,
  enhancedLogger,
  healthMonitor,
  LogCategory,
  lang,
  notifyModalTimeout,
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

export const memoryAddHandler = async (interaction: ChatInputCommandInteraction) => {
  const startTime = Date.now();
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  // Rate limit check
  const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-add');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: rateCheck.message!,
      flags: [MessageFlags.Ephemeral],
    });
    healthMonitor.recordCommand('memory add', Date.now() - startTime, true);
    return;
  }

  // Check if memory system is configured
  const config = await memoryConfigRepo.findOneBy({ guildId });
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.errors.notConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Get available tags for dropdowns
  const categoryTags = await memoryTagRepo.find({
    where: { guildId, tagType: 'category' },
  });
  const statusTags = await memoryTagRepo.find({
    where: { guildId, tagType: 'status' },
  });

  if (categoryTags.length === 0 || statusTags.length === 0) {
    await interaction.reply({
      content: `${E.error} ${tl.add.noTagsConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const selectionState = createDefaultSelectionState(statusTags);

  await runTagSelectionCollector(
    interaction,
    categoryTags,
    statusTags,
    selectionState,
    {
      prefix: 'memory_add',
      title: `${E.memory} Add Memory Item`,
      description: 'Select a category and status for your new item.',
    },
    async i => {
      await showAddModal(i, selectionState, guildId, config.forumChannelId);
    },
  );
};

async function showAddModal(
  interaction: MessageComponentInteraction,
  selectionState: TagSelectionState,
  guildId: string,
  forumChannelId: string,
) {
  const modal = new ModalBuilder()
    .setCustomId(`memory_add_modal_${selectionState.categoryId}_${selectionState.statusId}`)
    .setTitle(tl.add.modalTitle);

  const titleInput = new TextInputBuilder()
    .setCustomId('memory_title')
    .setLabel(tl.add.titleLabel)
    .setPlaceholder(tl.add.titlePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('memory_description')
    .setLabel(tl.add.descriptionLabel)
    .setPlaceholder(tl.add.descriptionPlaceholder)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
  );

  await interaction.showModal(modal);

  try {
    const modalSubmit = await interaction.awaitModalSubmit({
      time: 300000,
      filter: (i: ModalSubmitInteraction) =>
        i.customId.startsWith('memory_add_modal_') && i.user.id === interaction.user.id,
    });

    await handleModalSubmit(modalSubmit, selectionState, guildId, forumChannelId);
  } catch {
    await notifyModalTimeout(interaction);
  }
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  selectionState: TagSelectionState,
  guildId: string,
  forumChannelId: string,
) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const title = interaction.fields.getTextInputValue('memory_title');
    const description = interaction.fields.getTextInputValue('memory_description');

    const forum = (await interaction.guild!.channels.fetch(forumChannelId)) as ForumChannel;
    if (!forum) {
      await interaction.editReply({
        content: `${E.error} ${tl.errors.forumNotFound}`,
      });
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

    const appliedTags: string[] = [];
    if (categoryTag?.discordTagId) appliedTags.push(categoryTag.discordTagId);
    if (statusTag?.discordTagId) appliedTags.push(statusTag.discordTagId);

    const content = `**Description:**\n\n${description}\n\n-# Created by ${interaction.user.displayName}`;

    const thread = await forum.threads.create({
      name: title,
      message: { content },
      appliedTags,
    });

    const memoryItem = memoryItemRepo.create({
      guildId,
      threadId: thread.id,
      title,
      description,
      status: statusTag?.name || 'Open',
      createdBy: interaction.user.id,
    });
    await memoryItemRepo.save(memoryItem);

    await interaction.editReply({
      content: `${E.success} ${tl.add.success}\n${tl.add.viewThread}: <#${thread.id}>`,
    });
  } catch (error) {
    enhancedLogger.error(
      `Memory add error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({ content: `${E.error} ${tl.add.error}` });
  }
}
