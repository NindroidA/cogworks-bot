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
import { MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
  E,
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  lang,
  RateLimits,
  sanitizeUserInput,
  showAndAwaitModal,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { resolveMemoryConfig } from './channelPicker';
import { createDefaultSelectionState, runTagSelectionCollector, type TagSelectionState } from './tagSelection';

const tl = lang.memory;
const memoryTagRepo = lazyRepo(MemoryTag);
const memoryItemRepo = lazyRepo(MemoryItem);

export const memoryAddHandler = async (interaction: ChatInputCommandInteraction) => {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'memory-add',
    limit: RateLimits.MEMORY_OPERATION,
    scope: 'userGuild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;

  // Check if memory system is configured
  const config = await resolveMemoryConfig(interaction, guildId);
  if (!config) return;

  // Get available tags for dropdowns
  const categoryTags = await memoryTagRepo.find({
    where: { guildId, memoryConfigId: config.id, tagType: 'category' },
  });
  const statusTags = await memoryTagRepo.find({
    where: { guildId, memoryConfigId: config.id, tagType: 'status' },
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
      await showAddModal(i, selectionState, guildId, config.forumChannelId, config.id);
    },
  );
};

async function showAddModal(
  interaction: MessageComponentInteraction,
  selectionState: TagSelectionState,
  guildId: string,
  forumChannelId: string,
  memoryConfigId: number,
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

  const modalSubmit = await showAndAwaitModal(interaction as any, modal);
  if (!modalSubmit) return;

  await handleModalSubmit(modalSubmit, selectionState, guildId, forumChannelId, memoryConfigId);
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  selectionState: TagSelectionState,
  guildId: string,
  forumChannelId: string,
  memoryConfigId: number,
) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const title = sanitizeUserInput(interaction.fields.getTextInputValue('memory_title'));
    const description = sanitizeUserInput(interaction.fields.getTextInputValue('memory_description'));

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
      memoryConfigId,
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
