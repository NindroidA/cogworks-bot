import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type ForumChannel,
  type GuildForumTagData,
  MessageFlags,
} from 'discord.js';
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
import { MAX } from '../../../utils/constants';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { sanitizeUserInput } from '../../../utils/validation/inputSanitizer';

const tl = lang.memory;
const memoryConfigRepo = lazyRepo(MemoryConfig);
const memoryTagRepo = lazyRepo(MemoryTag);

// ---------------------------------------------------------------------------
// Resolve which memory config to use for tag operations
// ---------------------------------------------------------------------------

async function resolveConfigForTags(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<MemoryConfig | null> {
  const channelOption = interaction.options.getChannel('channel');

  const configs = await memoryConfigRepo.find({
    where: guildId ? { guildId } : undefined,
    order: { sortOrder: 'ASC' },
  });

  if (configs.length === 0) {
    await interaction.reply({
      content: `${E.error} ${tl.errors.notConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  // If a channel was explicitly provided, find the matching config
  if (channelOption) {
    const config = configs.find(c => c.forumChannelId === channelOption.id);
    if (!config) {
      await interaction.reply({
        content: `${E.error} ${tl.errors.forumNotFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return null;
    }
    return config;
  }

  // If only one channel, use it automatically
  if (configs.length === 1) {
    return configs[0];
  }

  // Multiple channels and none specified — ask
  await interaction.reply({
    content: `${E.error} ${tl.manageTags.selectChannel}`,
    flags: [MessageFlags.Ephemeral],
  });
  return null;
}

// ---------------------------------------------------------------------------
// Tag-add handler
// ---------------------------------------------------------------------------

async function handleTagAdd(interaction: ChatInputCommandInteraction, guildId: string) {
  const config = await resolveConfigForTags(interaction, guildId);
  if (!config) return;

  const rawName = interaction.options.getString('name', true);
  const tagType = interaction.options.getString('type', true) as MemoryTagType;
  const emoji = interaction.options.getString('emoji') || null;

  // Sanitize tag name
  const name = sanitizeUserInput(rawName, { maxLength: MAX.MEMORY_TAG_NAME_LENGTH }) || '';
  if (!name) {
    await interaction.reply({
      content: `${E.error} Tag name is required.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    // Check tag count limits per type
    const typeLimit = tagType === 'category' ? MAX.MEMORY_CATEGORY_TAGS : MAX.MEMORY_STATUS_TAGS;
    const existingCount = await memoryTagRepo.count({
      where: { guildId, memoryConfigId: config.id, tagType },
    });

    if (existingCount >= typeLimit) {
      await interaction.editReply({
        content: `${E.error} ${tl.manageTags.add.limitReached.replace('{0}', String(typeLimit)).replace('{1}', tagType)}`,
      });
      return;
    }

    // Check total Discord forum tag limit
    const totalCount = await memoryTagRepo.count({
      where: { guildId, memoryConfigId: config.id },
    });
    if (totalCount >= MAX.DISCORD_FORUM_TAGS) {
      await interaction.editReply({
        content: `${E.error} ${tl.manageTags.add.discordLimit}`,
      });
      return;
    }

    // Check for duplicate name (case-insensitive within same config + type)
    const existingTags = await memoryTagRepo.find({
      where: { guildId, memoryConfigId: config.id, tagType },
    });
    const duplicate = existingTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      await interaction.editReply({
        content: `${E.error} ${tl.manageTags.add.duplicate.replace('{0}', tagType).replace('{1}', name)}`,
      });
      return;
    }

    // Create Discord forum tag
    const forum = (await interaction.guild!.channels.fetch(config.forumChannelId)) as ForumChannel;
    if (!forum) {
      await interaction.editReply({
        content: `${E.error} ${tl.errors.forumNotFound}`,
      });
      return;
    }

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

    // Find the newly created tag by comparing old and new
    const discordTag = updatedForum.availableTags.find(
      t => t.name === name && !currentTags.find(ct => ct.id === t.id),
    );

    // Save to database
    const newTag = memoryTagRepo.create({
      guildId,
      memoryConfigId: config.id,
      name,
      emoji,
      tagType,
      isDefault: false,
      discordTagId: discordTag?.id || null,
    });
    await memoryTagRepo.save(newTag);

    await interaction.editReply({
      content: `${E.success} ${tl.manageTags.add.success.replace('{0}', emoji ? `${emoji} ${name}` : name).replace('{1}', `<#${config.forumChannelId}>`)}`,
    });
  } catch (error) {
    enhancedLogger.error(
      `Memory tag-add error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({ content: `${E.error} ${tl.tags.add.error}` });
  }
}

// ---------------------------------------------------------------------------
// Tag-remove handler
// ---------------------------------------------------------------------------

async function handleTagRemove(interaction: ChatInputCommandInteraction, guildId: string) {
  const config = await resolveConfigForTags(interaction, guildId);
  if (!config) return;

  const tagIdStr = interaction.options.getString('tag', true);
  const tagId = Number.parseInt(tagIdStr, 10);

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const tag = await memoryTagRepo.findOneBy({
      id: tagId,
      guildId,
      memoryConfigId: config.id,
    });
    if (!tag) {
      await interaction.editReply({
        content: `${E.error} ${tl.manageTags.remove.notFound}`,
      });
      return;
    }

    if (tag.isDefault) {
      await interaction.editReply({
        content: `${E.error} ${tl.manageTags.remove.isDefault}`,
      });
      return;
    }

    // Remove from Discord forum
    const forum = (await interaction.guild!.channels.fetch(config.forumChannelId)) as ForumChannel;
    if (forum && tag.discordTagId) {
      const filteredTags = forum.availableTags
        .filter(t => t.id !== tag.discordTagId)
        .map(t => ({ id: t.id, name: t.name, emoji: t.emoji }));
      await forum.setAvailableTags(filteredTags);
    }

    // Delete from database
    await memoryTagRepo.remove(tag);

    await interaction.editReply({
      content: `${E.success} ${tl.manageTags.remove.success.replace('{0}', tag.emoji ? `${tag.emoji} ${tag.name}` : tag.name)}`,
    });
  } catch (error) {
    enhancedLogger.error(
      `Memory tag-remove error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({
      content: `${E.error} ${tl.tags.remove.error}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Tag-edit handler
// ---------------------------------------------------------------------------

async function handleTagEdit(interaction: ChatInputCommandInteraction, guildId: string) {
  const config = await resolveConfigForTags(interaction, guildId);
  if (!config) return;

  const tagIdStr = interaction.options.getString('tag', true);
  const tagId = Number.parseInt(tagIdStr, 10);
  const rawName = interaction.options.getString('name');
  const emoji = interaction.options.getString('emoji');

  if (!rawName && emoji === null) {
    await interaction.reply({
      content: `${E.error} ${tl.manageTags.edit.noChanges}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const newName = rawName
    ? sanitizeUserInput(rawName, { maxLength: MAX.MEMORY_TAG_NAME_LENGTH }) || undefined
    : undefined;

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const tag = await memoryTagRepo.findOneBy({
      id: tagId,
      guildId,
      memoryConfigId: config.id,
    });
    if (!tag) {
      await interaction.editReply({
        content: `${E.error} ${tl.manageTags.edit.notFound}`,
      });
      return;
    }

    // Check name conflict if changing name
    if (newName && newName.toLowerCase() !== tag.name.toLowerCase()) {
      const existingTags = await memoryTagRepo.find({
        where: { guildId, memoryConfigId: config.id, tagType: tag.tagType },
      });
      const conflict = existingTags.find(
        t => t.id !== tag.id && t.name.toLowerCase() === newName.toLowerCase(),
      );
      if (conflict) {
        await interaction.editReply({
          content: `${E.error} ${tl.manageTags.add.duplicate.replace('{0}', tag.tagType).replace('{1}', newName)}`,
        });
        return;
      }
    }

    // Update Discord forum tag
    const forum = (await interaction.guild!.channels.fetch(config.forumChannelId)) as ForumChannel;
    if (forum && tag.discordTagId) {
      const updatedTags = forum.availableTags.map(t => {
        if (t.id === tag.discordTagId) {
          return {
            id: t.id,
            name: newName || tag.name,
            emoji: emoji !== null ? (emoji ? { id: null, name: emoji } : null) : t.emoji,
          };
        }
        return { id: t.id, name: t.name, emoji: t.emoji };
      });
      await forum.setAvailableTags(updatedTags as GuildForumTagData[]);
    }

    // Update database
    if (newName) tag.name = newName;
    if (emoji !== null) tag.emoji = emoji || null;
    await memoryTagRepo.save(tag);

    const displayName = tag.emoji ? `${tag.emoji} ${tag.name}` : tag.name;
    await interaction.editReply({
      content: `${E.success} ${tl.manageTags.edit.success.replace('{0}', displayName)}`,
    });
  } catch (error) {
    enhancedLogger.error(
      `Memory tag-edit error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({
      content: `${E.error} ${tl.tags.edit.error}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Tag-list handler
// ---------------------------------------------------------------------------

async function handleTagList(interaction: ChatInputCommandInteraction, guildId: string) {
  const config = await resolveConfigForTags(interaction, guildId);
  if (!config) return;

  const categoryTags = await memoryTagRepo.find({
    where: { guildId, memoryConfigId: config.id, tagType: 'category' },
  });
  const statusTags = await memoryTagRepo.find({
    where: { guildId, memoryConfigId: config.id, tagType: 'status' },
  });

  if (categoryTags.length === 0 && statusTags.length === 0) {
    await interaction.reply({
      content: `${E.info} ${tl.manageTags.list.empty}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${E.list} ${tl.manageTags.list.title}`)
    .setDescription(`<#${config.forumChannelId}>`)
    .setColor(Colors.brand.primary);

  if (categoryTags.length > 0) {
    const categoryList = categoryTags
      .map(t => `${t.emoji || '\u2022'} ${t.name}${t.isDefault ? ` ${tl.tags.list.default}` : ''}`)
      .join('\n');
    embed.addFields({
      name: tl.tags.categoryTags,
      value: categoryList,
      inline: true,
    });
  }

  if (statusTags.length > 0) {
    const statusList = statusTags
      .map(t => `${t.emoji || '\u2022'} ${t.name}${t.isDefault ? ` ${tl.tags.list.default}` : ''}`)
      .join('\n');
    embed.addFields({
      name: tl.tags.statusTags,
      value: statusList,
      inline: true,
    });
  }

  embed.setFooter({
    text: tl.manageTags.list.footer
      .replace('{0}', String(categoryTags.length))
      .replace('{1}', String(MAX.MEMORY_CATEGORY_TAGS))
      .replace('{2}', String(statusTags.length))
      .replace('{3}', String(MAX.MEMORY_STATUS_TAGS)),
  });

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

// ---------------------------------------------------------------------------
// Tag-reset handler
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORY_TAGS = [
  { name: 'Bug', emoji: '\u{1F41B}' },
  { name: 'Feature', emoji: '\u2728' },
  { name: 'Suggestion', emoji: '\u{1F4A1}' },
  { name: 'Reminder', emoji: '\u23F0' },
  { name: 'Note', emoji: '\u{1F4DD}' },
];

const DEFAULT_STATUS_TAGS = [
  { name: 'Open', emoji: '\u{1F4CB}' },
  { name: 'In Progress', emoji: '\u{1F527}' },
  { name: 'On Hold', emoji: '\u23F8\uFE0F' },
  { name: 'Completed', emoji: '\u2705' },
];

async function handleTagReset(interaction: ChatInputCommandInteraction, guildId: string) {
  const config = await resolveConfigForTags(interaction, guildId);
  if (!config) return;

  // Confirmation button
  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('memory_tag_reset_confirm')
      .setLabel(lang.general.buttons.confirm)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('memory_tag_reset_cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  const response = await interaction.reply({
    content: `${E.warning} ${tl.manageTags.reset.confirm}`,
    components: [confirmRow],
    flags: [MessageFlags.Ephemeral],
  });

  try {
    const i = await response.awaitMessageComponent({
      filter: ci => ci.user.id === interaction.user.id,
      time: 30000,
    });

    if (i.customId === 'memory_tag_reset_cancel') {
      await i.update({ content: lang.errors.cancelled, components: [] });
      return;
    }

    if (i.customId === 'memory_tag_reset_confirm') {
      await i.update({
        content: `${E.loading} Processing...`,
        components: [],
      });

      try {
        // Delete all custom tags from DB
        await memoryTagRepo.delete({
          guildId,
          memoryConfigId: config.id,
          isDefault: false,
        });

        // Delete all existing default tags too (we'll re-create)
        await memoryTagRepo.delete({
          guildId,
          memoryConfigId: config.id,
          isDefault: true,
        });

        // Rebuild default tags on the forum
        const forum = (await interaction.guild!.channels.fetch(
          config.forumChannelId,
        )) as ForumChannel;
        if (forum) {
          const allTags: GuildForumTagData[] = [];
          const dbTags: Partial<MemoryTag>[] = [];

          for (const tag of DEFAULT_CATEGORY_TAGS) {
            allTags.push({
              name: tag.name,
              emoji: { id: null, name: tag.emoji },
            });
            dbTags.push({
              guildId,
              memoryConfigId: config.id,
              name: tag.name,
              emoji: tag.emoji,
              tagType: 'category' as MemoryTagType,
              isDefault: true,
            });
          }

          for (const tag of DEFAULT_STATUS_TAGS) {
            allTags.push({
              name: tag.name,
              emoji: { id: null, name: tag.emoji },
            });
            dbTags.push({
              guildId,
              memoryConfigId: config.id,
              name: tag.name,
              emoji: tag.emoji,
              tagType: 'status' as MemoryTagType,
              isDefault: true,
            });
          }

          const updatedForum = await forum.setAvailableTags(allTags);

          for (const dbTag of dbTags) {
            const discordTag = updatedForum.availableTags.find(t => t.name === dbTag.name);
            if (discordTag) {
              dbTag.discordTagId = discordTag.id;
            }
          }

          await memoryTagRepo.save(dbTags as MemoryTag[]);
        }

        await i.editReply({
          content: `${E.success} ${tl.manageTags.reset.success}`,
        });
      } catch (error) {
        enhancedLogger.error(
          `Memory tag-reset error: ${error}`,
          error instanceof Error ? error : undefined,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
        await i.editReply({ content: `${E.error} ${tl.setup.error}` });
      }
    }
  } catch {
    await interaction
      .editReply({
        content: lang.errors.timeout,
        components: [],
      })
      .catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// Autocomplete handler for tag selection
// ---------------------------------------------------------------------------

export async function memoryTagAutocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused(true);
  const subcommand = interaction.options.getSubcommand();

  if (focused.name !== 'tag') {
    await interaction.respond([]);
    return;
  }

  try {
    const query = focused.value.toLowerCase();

    // For tag-remove: only show custom tags (isDefault: false)
    // For tag-edit: show all tags
    const isRemove = subcommand === 'tag-remove';

    // Get channel option if provided
    const channelId = interaction.options.get('channel')?.value as string | undefined;

    let configs: MemoryConfig[];
    if (channelId) {
      const config = await memoryConfigRepo.findOneBy({
        guildId,
        forumChannelId: channelId,
      });
      configs = config ? [config] : [];
    } else {
      configs = await memoryConfigRepo.find({ where: { guildId } });
    }

    if (configs.length === 0) {
      await interaction.respond([{ name: tl.manageTags.autocomplete.noTags, value: '0' }]);
      return;
    }

    const configIds = configs.map(c => c.id);

    let tags: MemoryTag[];
    if (isRemove) {
      tags = await memoryTagRepo
        .createQueryBuilder('tag')
        .where('tag.guildId = :guildId', { guildId })
        .andWhere('tag.memoryConfigId IN (:...configIds)', { configIds })
        .andWhere('tag.isDefault = :isDefault', { isDefault: false })
        .getMany();
    } else {
      tags = await memoryTagRepo
        .createQueryBuilder('tag')
        .where('tag.guildId = :guildId', { guildId })
        .andWhere('tag.memoryConfigId IN (:...configIds)', { configIds })
        .getMany();
    }

    const filtered = query ? tags.filter(t => t.name.toLowerCase().includes(query)) : tags;

    const choices = filtered.slice(0, 25).map(tag => ({
      name: `${tag.emoji ? `${tag.emoji} ` : ''}${tag.name} (${tag.tagType}${tag.isDefault ? ', default' : ''})`.slice(
        0,
        100,
      ),
      value: tag.id.toString(),
    }));

    if (choices.length === 0) {
      await interaction.respond([{ name: tl.manageTags.autocomplete.noTags, value: '0' }]);
      return;
    }

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}

// ---------------------------------------------------------------------------
// Main exported handler
// ---------------------------------------------------------------------------

export const manageTagsHandler = async (
  interaction: ChatInputCommandInteraction,
  subcommand: string,
) => {
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

  const rateLimitKey = createRateLimitKey.guild(guildId, 'memory-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BOT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: rateCheck.message!,
      flags: [MessageFlags.Ephemeral],
    });
    healthMonitor.recordCommand('memory-setup', Date.now() - startTime, true);
    return;
  }

  switch (subcommand) {
    case 'tag-add':
      await handleTagAdd(interaction, guildId);
      break;
    case 'tag-remove':
      await handleTagRemove(interaction, guildId);
      break;
    case 'tag-edit':
      await handleTagEdit(interaction, guildId);
      break;
    case 'tag-list':
      await handleTagList(interaction, guildId);
      break;
    case 'tag-reset':
      await handleTagReset(interaction, guildId);
      break;
  }

  healthMonitor.recordCommand('memory-setup', Date.now() - startTime, false);
};
