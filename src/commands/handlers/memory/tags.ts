import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type ForumChannel,
  type GuildForumTagData,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { MemoryConfig, MemoryTag, type MemoryTagType } from '../../../typeorm/entities/memory';
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

export const memoryTagsHandler = async (interaction: ChatInputCommandInteraction) => {
  const startTime = Date.now();
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const action = interaction.options.getString('action', true);

  // Rate limit check
  const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-tags');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
  if (!rateCheck.allowed) {
    await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
    healthMonitor.recordCommand('memory tags', Date.now() - startTime, true);
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

  switch (action) {
    case 'add':
      await handleAddTag(interaction, guildId, config.forumChannelId);
      break;
    case 'edit':
      await handleEditTag(interaction, guildId, config.forumChannelId);
      break;
    case 'remove':
      await handleRemoveTag(interaction, guildId, config.forumChannelId);
      break;
    case 'list':
      await handleListTags(interaction, guildId);
      break;
  }
};

async function handleAddTag(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  forumChannelId: string,
) {
  const modal = new ModalBuilder()
    .setCustomId('memory_tag_add_modal')
    .setTitle(tl.tags.add.modalTitle);

  const nameInput = new TextInputBuilder()
    .setCustomId('tag_name')
    .setLabel(tl.tags.add.nameLabel)
    .setPlaceholder(tl.tags.add.namePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const emojiInput = new TextInputBuilder()
    .setCustomId('tag_emoji')
    .setLabel(tl.tags.add.emojiLabel)
    .setPlaceholder(tl.tags.add.emojiPlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const typeInput = new TextInputBuilder()
    .setCustomId('tag_type')
    .setLabel(tl.tags.add.typeLabel)
    .setPlaceholder('category or status')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
  );

  await interaction.showModal(modal);

  try {
    const modalSubmit = await interaction.awaitModalSubmit({
      time: 300000,
      filter: i => i.customId === 'memory_tag_add_modal' && i.user.id === interaction.user.id,
    });

    await handleAddTagSubmit(modalSubmit, guildId, forumChannelId);
  } catch {
    // Modal timed out or was cancelled
  }
}

async function handleAddTagSubmit(
  interaction: ModalSubmitInteraction,
  guildId: string,
  forumChannelId: string,
) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const name = interaction.fields.getTextInputValue('tag_name');
    const emoji = interaction.fields.getTextInputValue('tag_emoji') || null;
    const typeInput = interaction.fields.getTextInputValue('tag_type').toLowerCase();

    // Validate tag type
    if (typeInput !== 'category' && typeInput !== 'status') {
      await interaction.editReply({
        content: `${E.error} Tag type must be "category" or "status"`,
      });
      return;
    }

    const tagType: MemoryTagType = typeInput as MemoryTagType;

    // Check for duplicate
    const existing = await memoryTagRepo.findOneBy({ guildId, name });
    if (existing) {
      await interaction.editReply({ content: `${E.error} ${tl.tags.add.duplicate}` });
      return;
    }

    // Get forum channel and add tag
    const forum = (await interaction.guild!.channels.fetch(forumChannelId)) as ForumChannel;
    if (!forum) {
      await interaction.editReply({ content: `${E.error} ${tl.errors.forumNotFound}` });
      return;
    }

    // Add to Discord forum
    const newForumTag: GuildForumTagData = {
      name,
      emoji: emoji ? { id: null, name: emoji } : null,
    };

    const currentTags = forum.availableTags.map(t => ({
      id: t.id,
      name: t.name,
      emoji: t.emoji,
    }));

    const updatedForum = await forum.setAvailableTags([...currentTags, newForumTag]);

    // Find the new tag's Discord ID
    const discordTag = updatedForum.availableTags.find(
      t => t.name === name && !currentTags.find(ct => ct.id === t.id),
    );

    // Save to database
    const newTag = memoryTagRepo.create({
      guildId,
      name,
      emoji,
      tagType,
      isDefault: false,
      discordTagId: discordTag?.id || null,
    });
    await memoryTagRepo.save(newTag);

    await interaction.editReply({ content: `${E.success} ${tl.tags.add.success}` });
  } catch (error) {
    enhancedLogger.error(
      `Memory tag add error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({ content: `${E.error} ${tl.tags.add.error}` });
  }
}

async function handleEditTag(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  forumChannelId: string,
) {
  const tags = await memoryTagRepo.find({ where: { guildId } });

  if (tags.length === 0) {
    await interaction.reply({
      content: `${E.error} ${tl.tags.noTags}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const tagOptions = tags.map(tag => ({
    label: `${tag.emoji || ''} ${tag.name}`.trim(),
    description: `${tag.tagType} tag${tag.isDefault ? ' (default)' : ''}`,
    value: tag.id.toString(),
  }));

  const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_tag_edit_select')
      .setPlaceholder(tl.tags.edit.selectTag)
      .addOptions(tagOptions),
  );

  const response = await interaction.reply({
    content: tl.tags.edit.selectTag,
    components: [selectMenu],
    flags: [MessageFlags.Ephemeral],
  });

  const collector = response.createMessageComponentCollector({ time: 60000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: lang.errors.notYourInteraction, flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (i.isStringSelectMenu() && i.customId === 'memory_tag_edit_select') {
      collector.stop('selected');
      await showEditModal(i as StringSelectMenuInteraction, guildId, forumChannelId);
    }
  });
}

async function showEditModal(
  interaction: StringSelectMenuInteraction,
  guildId: string,
  forumChannelId: string,
) {
  const tagId = parseInt(interaction.values[0], 10);
  const tag = await memoryTagRepo.findOneBy({ id: tagId, guildId });

  if (!tag) {
    await interaction.reply({
      content: `${E.error} ${tl.tags.edit.tagNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`memory_tag_edit_modal_${tagId}`)
    .setTitle(tl.tags.edit.modalTitle);

  const nameInput = new TextInputBuilder()
    .setCustomId('tag_name')
    .setLabel(tl.tags.add.nameLabel)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50)
    .setValue(tag.name);

  const emojiInput = new TextInputBuilder()
    .setCustomId('tag_emoji')
    .setLabel(tl.tags.add.emojiLabel)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10)
    .setValue(tag.emoji || '');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput),
  );

  await interaction.showModal(modal);

  try {
    const modalSubmit = await interaction.awaitModalSubmit({
      time: 300000,
      filter: i =>
        i.customId === `memory_tag_edit_modal_${tagId}` && i.user.id === interaction.user.id,
    });

    await handleEditTagSubmit(modalSubmit, tagId, guildId, forumChannelId);
  } catch {
    // Modal timed out
  }
}

async function handleEditTagSubmit(
  interaction: ModalSubmitInteraction,
  tagId: number,
  guildId: string,
  forumChannelId: string,
) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const name = interaction.fields.getTextInputValue('tag_name');
    const emoji = interaction.fields.getTextInputValue('tag_emoji') || null;

    const tag = await memoryTagRepo.findOneBy({ id: tagId, guildId });
    if (!tag) {
      await interaction.editReply({ content: `${E.error} ${tl.tags.edit.tagNotFound}` });
      return;
    }

    // Update Discord forum tag
    const forum = (await interaction.guild!.channels.fetch(forumChannelId)) as ForumChannel;
    if (forum && tag.discordTagId) {
      const updatedTags = forum.availableTags.map(t => {
        if (t.id === tag.discordTagId) {
          return {
            id: t.id,
            name,
            emoji: emoji ? { id: null, name: emoji } : null,
          };
        }
        return { id: t.id, name: t.name, emoji: t.emoji };
      });
      await forum.setAvailableTags(updatedTags as GuildForumTagData[]);
    }

    // Update database
    tag.name = name;
    tag.emoji = emoji;
    await memoryTagRepo.save(tag);

    await interaction.editReply({ content: `${E.success} ${tl.tags.edit.success}` });
  } catch (error) {
    enhancedLogger.error(
      `Memory tag edit error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({ content: `${E.error} ${tl.tags.edit.error}` });
  }
}

async function handleRemoveTag(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  forumChannelId: string,
) {
  const tags = await memoryTagRepo.find({ where: { guildId, isDefault: false } });

  if (tags.length === 0) {
    await interaction.reply({
      content: `${E.info} ${tl.tags.remove.cannotRemoveDefault}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const tagOptions = tags.map(tag => ({
    label: `${tag.emoji || ''} ${tag.name}`.trim(),
    description: `${tag.tagType} tag`,
    value: tag.id.toString(),
  }));

  const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_tag_remove_select')
      .setPlaceholder(tl.tags.remove.selectTag)
      .addOptions(tagOptions),
  );

  const response = await interaction.reply({
    content: tl.tags.remove.selectTag,
    components: [selectMenu],
    flags: [MessageFlags.Ephemeral],
  });

  const collector = response.createMessageComponentCollector({ time: 60000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: lang.errors.notYourInteraction, flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (i.isStringSelectMenu() && i.customId === 'memory_tag_remove_select') {
      collector.stop('selected');
      await confirmRemoveTag(i as StringSelectMenuInteraction, guildId, forumChannelId);
    }
  });
}

async function confirmRemoveTag(
  interaction: StringSelectMenuInteraction,
  guildId: string,
  forumChannelId: string,
) {
  const tagId = parseInt(interaction.values[0], 10);
  const tag = await memoryTagRepo.findOneBy({ id: tagId, guildId });

  if (!tag) {
    await interaction.reply({
      content: `${E.error} ${tl.tags.edit.tagNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`memory_tag_remove_confirm_${tagId}`)
      .setLabel(lang.general.buttons.confirm)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('memory_tag_remove_cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    content: `${tl.tags.remove.confirmTitle}\n\n${tl.tags.remove.confirmMessage}\n\nTag: **${tag.emoji || ''} ${tag.name}**`,
    components: [confirmRow],
  });

  const collector = interaction.message.createMessageComponentCollector({ time: 30000 });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: lang.errors.notYourInteraction, flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (i.customId === 'memory_tag_remove_cancel') {
      collector.stop('cancelled');
      await i.update({ content: tl.tags.remove.cancelled, components: [] });
      return;
    }

    if (i.customId === `memory_tag_remove_confirm_${tagId}`) {
      collector.stop('confirmed');

      try {
        // Remove from Discord forum
        const forum = (await interaction.guild!.channels.fetch(forumChannelId)) as ForumChannel;
        if (forum && tag.discordTagId) {
          const filteredTags = forum.availableTags
            .filter(t => t.id !== tag.discordTagId)
            .map(t => ({ id: t.id, name: t.name, emoji: t.emoji }));
          await forum.setAvailableTags(filteredTags);
        }

        // Remove from database
        await memoryTagRepo.remove(tag);

        await i.update({ content: `${E.success} ${tl.tags.remove.success}`, components: [] });
      } catch (error) {
        enhancedLogger.error(
          `Memory tag remove error: ${error}`,
          error instanceof Error ? error : undefined,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
        await i.update({ content: `${E.error} ${tl.tags.remove.error}`, components: [] });
      }
    }
  });
}

async function handleListTags(interaction: ChatInputCommandInteraction, guildId: string) {
  const categoryTags = await memoryTagRepo.find({ where: { guildId, tagType: 'category' } });
  const statusTags = await memoryTagRepo.find({ where: { guildId, tagType: 'status' } });

  if (categoryTags.length === 0 && statusTags.length === 0) {
    await interaction.reply({
      content: `${E.info} ${tl.tags.list.empty}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${E.list} ${tl.tags.list.title}`)
    .setColor(Colors.brand.primary);

  if (categoryTags.length > 0) {
    const categoryList = categoryTags
      .map(t => `${t.emoji || '•'} ${t.name}${t.isDefault ? ` ${tl.tags.list.default}` : ''}`)
      .join('\n');
    embed.addFields({ name: tl.tags.categoryTags, value: categoryList, inline: true });
  }

  if (statusTags.length > 0) {
    const statusList = statusTags
      .map(t => `${t.emoji || '•'} ${t.name}${t.isDefault ? ` ${tl.tags.list.default}` : ''}`)
      .join('\n');
    embed.addFields({ name: tl.tags.statusTags, value: statusList, inline: true });
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}
