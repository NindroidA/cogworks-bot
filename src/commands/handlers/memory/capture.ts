import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type ForumChannel,
  type Message,
  type MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
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

// Regex patterns
const MESSAGE_LINK_REGEX =
  /https:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

export const memoryCaptureHandler = async (interaction: ChatInputCommandInteraction) => {
  const startTime = Date.now();
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  // Rate limit check
  const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-capture');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
  if (!rateCheck.allowed) {
    await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
    healthMonitor.recordCommand('memory capture', Date.now() - startTime, true);
    return;
  }

  const messageInput = interaction.options.getString('message');

  // Check if memory system is configured
  const config = await memoryConfigRepo.findOneBy({ guildId });
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.errors.notConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!messageInput) {
    await interaction.reply({
      content: `${E.error} ${tl.capture.noReplyOrLink}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Resolve target message — accept message ID or full link
  let targetMessage: Message | null = null;
  let sourceChannelId: string | null = null;
  let sourceMessageId: string | null = null;

  if (SNOWFLAKE_REGEX.test(messageInput)) {
    // Raw message ID — fetch from current channel
    try {
      if (interaction.channel?.isTextBased()) {
        targetMessage = await (interaction.channel as TextChannel).messages.fetch(messageInput);
        sourceChannelId = interaction.channelId;
        sourceMessageId = messageInput;
      }
    } catch {
      await interaction.reply({
        content: `${E.error} ${tl.capture.messageNotFoundHint}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  } else if (MESSAGE_LINK_REGEX.test(messageInput)) {
    // Full message link
    const match = messageInput.match(MESSAGE_LINK_REGEX)!;
    const [, linkGuildId, channelId, messageId] = match;

    // Verify same guild
    if (linkGuildId !== guildId) {
      await interaction.reply({
        content: `${E.error} ${tl.capture.messageWrongGuild}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    try {
      const channel = await interaction.guild!.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        targetMessage = await (channel as TextChannel).messages.fetch(messageId);
        sourceChannelId = channelId;
        sourceMessageId = messageId;
      }
    } catch {
      await interaction.reply({
        content: `${E.error} ${tl.capture.messageNotFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  } else {
    await interaction.reply({
      content: `${E.error} ${tl.capture.invalidInput}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!targetMessage) {
    await interaction.reply({
      content: `${E.error} ${tl.capture.messageNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Capture source author info
  const sourceAuthor = targetMessage.author.displayName;

  // Get available tags for selection
  const categoryTags = await memoryTagRepo.find({ where: { guildId, tagType: 'category' } });
  const statusTags = await memoryTagRepo.find({ where: { guildId, tagType: 'status' } });

  if (categoryTags.length === 0 || statusTags.length === 0) {
    await interaction.reply({
      content: `${E.error} ${tl.add.noTagsConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const categoryOptions = categoryTags.map(tag => ({
    label: tag.name,
    value: tag.id.toString(),
    emoji: tag.emoji || undefined,
  }));

  const statusOptions = statusTags.map(tag => ({
    label: tag.name,
    value: tag.id.toString(),
    emoji: tag.emoji || undefined,
  }));

  const defaultStatus = statusTags.find(t => t.name === 'Open') || statusTags[0];

  // Store selection state
  const selectionState: {
    categoryId: string | null;
    categoryName: string | null;
    statusId: string;
    statusName: string;
    sourceChannelId: string | null;
    sourceMessageId: string | null;
    sourceAuthor: string;
  } = {
    categoryId: null,
    categoryName: null,
    statusId: defaultStatus.id.toString(),
    statusName: defaultStatus.emoji
      ? `${defaultStatus.emoji} ${defaultStatus.name}`
      : defaultStatus.name,
    sourceChannelId,
    sourceMessageId,
    sourceAuthor,
  };

  // Show message preview
  const preview =
    targetMessage.content.length > 200
      ? `${targetMessage.content.slice(0, 200)}...`
      : targetMessage.content;

  // Build initial embed showing current selections
  const buildEmbed = () => {
    return new EmbedBuilder()
      .setTitle(`${E.memory} Capture Message`)
      .setDescription(`**Capturing from ${sourceAuthor}:**\n> ${preview}`)
      .setColor(Colors.brand.primary)
      .addFields(
        {
          name: 'Category',
          value: selectionState.categoryName || '*(not selected)*',
          inline: true,
        },
        {
          name: 'Status',
          value: selectionState.statusName || '*(not selected)*',
          inline: true,
        },
      );
  };

  const categorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_capture_category')
      .setPlaceholder(tl.add.selectCategory)
      .addOptions(categoryOptions),
  );

  const statusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_capture_status')
      .setPlaceholder(tl.add.selectStatus)
      .addOptions(
        statusOptions.map(opt => ({
          ...opt,
          default: opt.value === selectionState.statusId,
        })),
      ),
  );

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('memory_capture_continue')
      .setLabel('Continue')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true), // Disabled until category is selected
    new ButtonBuilder()
      .setCustomId('memory_capture_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const response = await interaction.reply({
    embeds: [buildEmbed()],
    components: [categorySelect, statusSelect, buttonRow],
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

    if (i.customId === 'memory_capture_cancel') {
      collector.stop('cancelled');
      await i.update({
        content: lang.errors.cancelled,
        embeds: [],
        components: [],
      });
      return;
    }

    if (i.customId === 'memory_capture_continue') {
      collector.stop('continue');
      await showCaptureModal(i, selectionState, guildId, config.forumChannelId);
      return;
    }

    if (i.isStringSelectMenu()) {
      const selectInteraction = i as StringSelectMenuInteraction;

      if (selectInteraction.customId === 'memory_capture_category') {
        const selectedTag = categoryTags.find(t => t.id.toString() === selectInteraction.values[0]);
        selectionState.categoryId = selectInteraction.values[0];
        selectionState.categoryName = selectedTag?.emoji
          ? `${selectedTag.emoji} ${selectedTag.name}`
          : selectedTag?.name || null;
      } else if (selectInteraction.customId === 'memory_capture_status') {
        const selectedTag = statusTags.find(t => t.id.toString() === selectInteraction.values[0]);
        selectionState.statusId = selectInteraction.values[0];
        selectionState.statusName = selectedTag?.emoji
          ? `${selectedTag.emoji} ${selectedTag.name}`
          : selectedTag?.name || 'Unknown';
      }

      // Rebuild components with updated states
      const updatedCategorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('memory_capture_category')
          .setPlaceholder(tl.add.selectCategory)
          .addOptions(
            categoryOptions.map(opt => ({
              ...opt,
              default: opt.value === selectionState.categoryId,
            })),
          ),
      );

      const updatedStatusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('memory_capture_status')
          .setPlaceholder(tl.add.selectStatus)
          .addOptions(
            statusOptions.map(opt => ({
              ...opt,
              default: opt.value === selectionState.statusId,
            })),
          ),
      );

      const updatedButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('memory_capture_continue')
          .setLabel('Continue')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!selectionState.categoryId),
        new ButtonBuilder()
          .setCustomId('memory_capture_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );

      await selectInteraction.update({
        embeds: [buildEmbed()],
        components: [updatedCategorySelect, updatedStatusSelect, updatedButtonRow],
      });
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

async function showCaptureModal(
  interaction: MessageComponentInteraction,
  selectionState: {
    categoryId: string | null;
    statusId: string | null;
    categoryName: string | null;
    statusName: string | null;
    sourceChannelId: string | null;
    sourceMessageId: string | null;
    sourceAuthor: string;
  },
  guildId: string,
  forumChannelId: string,
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

  // Description starts EMPTY — user writes their own summary
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

    await handleCaptureModalSubmit(modalSubmit, selectionState, guildId, forumChannelId);
  } catch {
    // Modal timed out or was cancelled
  }
}

async function handleCaptureModalSubmit(
  interaction: ModalSubmitInteraction,
  selectionState: {
    categoryId: string | null;
    statusId: string | null;
    categoryName: string | null;
    statusName: string | null;
    sourceChannelId: string | null;
    sourceMessageId: string | null;
    sourceAuthor: string;
  },
  guildId: string,
  forumChannelId: string,
) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const title = interaction.fields.getTextInputValue('memory_title');
    const description = interaction.fields.getTextInputValue('memory_description');

    // Get the forum channel
    const forum = (await interaction.guild!.channels.fetch(forumChannelId)) as ForumChannel;
    if (!forum) {
      await interaction.editReply({ content: `${E.error} ${tl.errors.forumNotFound}` });
      return;
    }

    // Get the selected tags (include guildId for security)
    const categoryTag = selectionState.categoryId
      ? await memoryTagRepo.findOneBy({ id: parseInt(selectionState.categoryId, 10), guildId })
      : null;
    const statusTag = selectionState.statusId
      ? await memoryTagRepo.findOneBy({ id: parseInt(selectionState.statusId, 10), guildId })
      : null;

    // Build applied tags array
    const appliedTags: string[] = [];
    if (categoryTag?.discordTagId) appliedTags.push(categoryTag.discordTagId);
    if (statusTag?.discordTagId) appliedTags.push(statusTag.discordTagId);

    // Build formatted content for the forum post
    // Description section (may be empty if user didn't write one)
    let content = description ? `**Description:**\n\n${description}` : '';

    // Footer: "-# Captured from @username - Jump to message"
    if (selectionState.sourceChannelId && selectionState.sourceMessageId) {
      const sourceLink = `https://discord.com/channels/${guildId}/${selectionState.sourceChannelId}/${selectionState.sourceMessageId}`;
      const footer = `-# ${tl.capture.sourceLabel} ${selectionState.sourceAuthor} - [Jump to message](${sourceLink})`;
      content = content ? `${content}\n\n${footer}` : footer;
    } else {
      const footer = `-# Captured by ${interaction.user.displayName}`;
      content = content ? `${content}\n\n${footer}` : footer;
    }

    // Create the forum thread
    const thread = await forum.threads.create({
      name: title,
      message: { content },
      appliedTags,
    });

    // Save to database
    const memoryItem = memoryItemRepo.create({
      guildId,
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
