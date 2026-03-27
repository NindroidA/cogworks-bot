import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  DiscordAPIError,
  type ForumChannel,
  type Message,
  type MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  type TextChannel,
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
  notifyModalTimeout,
  RateLimits,
  sanitizeUserInput,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { resolveMemoryConfig } from './channelPicker';
import { createDefaultSelectionState, runTagSelectionCollector, type TagSelectionState } from './tagSelection';

const tl = lang.memory;
const memoryTagRepo = lazyRepo(MemoryTag);
const memoryItemRepo = lazyRepo(MemoryItem);

// Regex patterns
const MESSAGE_LINK_REGEX = /https:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/**
 * Map Discord API error codes to user-friendly messages.
 */
function getDiscordFetchErrorMessage(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    switch (error.code) {
      case 10008: // Unknown Message
        return tl.capture.messageDeleted;
      case 50001: // Missing Access
        return tl.capture.channelNoAccess;
      case 50013: // Missing Permissions
        return tl.capture.channelNoPermission;
    }
  }
  return tl.capture.messageNotFound;
}

/**
 * Resolve target message from user input (message ID or full link)
 */
async function resolveTargetMessage(
  interaction: ChatInputCommandInteraction,
  messageInput: string,
  guildId: string,
): Promise<{ message: Message; channelId: string; messageId: string } | null> {
  if (SNOWFLAKE_REGEX.test(messageInput)) {
    try {
      if (interaction.channel?.isTextBased()) {
        const msg = await (interaction.channel as TextChannel).messages.fetch(messageInput);
        return {
          message: msg,
          channelId: interaction.channelId,
          messageId: messageInput,
        };
      }
    } catch (error) {
      await interaction.reply({
        content: `${E.error} ${getDiscordFetchErrorMessage(error)}`,
        flags: [MessageFlags.Ephemeral],
      });
      return null;
    }
  } else if (MESSAGE_LINK_REGEX.test(messageInput)) {
    const match = messageInput.match(MESSAGE_LINK_REGEX)!;
    const [, linkGuildId, channelId, messageId] = match;

    if (linkGuildId !== guildId) {
      await interaction.reply({
        content: `${E.error} ${tl.capture.messageWrongGuild}`,
        flags: [MessageFlags.Ephemeral],
      });
      return null;
    }

    try {
      const channel = await interaction.guild!.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        const msg = await (channel as TextChannel).messages.fetch(messageId);
        return { message: msg, channelId, messageId };
      }
    } catch (error) {
      await interaction.reply({
        content: `${E.error} ${getDiscordFetchErrorMessage(error)}`,
        flags: [MessageFlags.Ephemeral],
      });
      return null;
    }
  } else {
    await interaction.reply({
      content: `${E.error} ${tl.capture.invalidInput}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  await interaction.reply({
    content: `${E.error} ${tl.capture.messageNotFound}`,
    flags: [MessageFlags.Ephemeral],
  });
  return null;
}

export const memoryCaptureHandler = async (interaction: ChatInputCommandInteraction) => {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'memory-capture',
    limit: RateLimits.MEMORY_OPERATION,
    scope: 'userGuild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;

  const messageInput = interaction.options.getString('message');

  const config = await resolveMemoryConfig(interaction, guildId);
  if (!config) return;

  if (!messageInput) {
    await interaction.reply({
      content: `${E.error} ${tl.capture.noReplyOrLink}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Resolve target message
  const resolved = await resolveTargetMessage(interaction, messageInput, guildId);
  if (!resolved) return;

  const { message: targetMessage, channelId: sourceChannelId, messageId: sourceMessageId } = resolved;
  const sourceAuthor = targetMessage.author.displayName;

  // Get available tags
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

  const selectionState: TagSelectionState & {
    sourceChannelId: string;
    sourceMessageId: string;
    sourceAuthor: string;
  } = {
    ...createDefaultSelectionState(statusTags),
    sourceChannelId,
    sourceMessageId,
    sourceAuthor,
  };

  const preview =
    targetMessage.content.length > 200 ? `${targetMessage.content.slice(0, 200)}...` : targetMessage.content;

  await runTagSelectionCollector(
    interaction,
    categoryTags,
    statusTags,
    selectionState,
    {
      prefix: 'memory_capture',
      title: `${E.memory} Capture Message`,
      description: `**Capturing from ${sourceAuthor}:**\n> ${preview}`,
    },
    async i => {
      await showCaptureModal(i, selectionState, guildId, config.forumChannelId, config.id);
    },
  );
};

async function showCaptureModal(
  interaction: MessageComponentInteraction,
  selectionState: TagSelectionState & {
    sourceChannelId: string;
    sourceMessageId: string;
    sourceAuthor: string;
  },
  guildId: string,
  forumChannelId: string,
  memoryConfigId: number,
) {
  const modal = new ModalBuilder()
    .setCustomId(`memory_capture_modal_${selectionState.categoryId}_${selectionState.statusId}`)
    .setTitle(tl.capture.modalTitle);

  const titleInput = new TextInputBuilder()
    .setCustomId('memory_title')
    .setLabel(tl.capture.titleLabel)
    .setPlaceholder(tl.capture.titlePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('memory_description')
    .setLabel(tl.add.descriptionLabel)
    .setPlaceholder(tl.add.descriptionPlaceholder)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
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
        i.customId.startsWith('memory_capture_modal_') && i.user.id === interaction.user.id,
    });

    await handleCaptureModalSubmit(modalSubmit, selectionState, guildId, forumChannelId, memoryConfigId);
  } catch {
    await notifyModalTimeout(interaction);
  }
}

async function handleCaptureModalSubmit(
  interaction: ModalSubmitInteraction,
  selectionState: TagSelectionState & {
    sourceChannelId: string;
    sourceMessageId: string;
    sourceAuthor: string;
  },
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

    let content = description ? `**Description:**\n\n${description}` : '';

    if (selectionState.sourceChannelId && selectionState.sourceMessageId) {
      const sourceLink = `https://discord.com/channels/${guildId}/${selectionState.sourceChannelId}/${selectionState.sourceMessageId}`;
      const footer = `-# ${tl.capture.sourceLabel} ${selectionState.sourceAuthor} - [Jump to message](${sourceLink})`;
      content = content ? `${content}\n\n${footer}` : footer;
    } else {
      const footer = `-# Captured by ${interaction.user.displayName}`;
      content = content ? `${content}\n\n${footer}` : footer;
    }

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
      description: description || '',
      status: statusTag?.name || 'Open',
      createdBy: interaction.user.id,
      sourceMessageId: selectionState.sourceMessageId || undefined,
      sourceChannelId: selectionState.sourceChannelId || undefined,
    });
    await memoryItemRepo.save(memoryItem);

    await interaction.editReply({
      content: `${E.success} ${tl.capture.success}\n${tl.add.viewThread}: <#${thread.id}>`,
    });
  } catch (error) {
    enhancedLogger.error(
      `Memory capture error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({ content: `${E.error} ${tl.capture.error}` });
  }
}
