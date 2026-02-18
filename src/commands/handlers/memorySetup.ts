import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  EmbedBuilder,
  type ForumChannel,
  type GuildForumTagData,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { MemoryConfig, MemoryTag, type MemoryTagType } from '../../typeorm/entities/memory';
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
} from '../../utils';

const tl = lang.memory;
const memoryConfigRepo = AppDataSource.getRepository(MemoryConfig);
const memoryTagRepo = AppDataSource.getRepository(MemoryTag);

// Default tags to create on first setup
const DEFAULT_CATEGORY_TAGS = [
  { name: 'Bug', emoji: '🐛' },
  { name: 'Feature', emoji: '✨' },
  { name: 'Suggestion', emoji: '💡' },
  { name: 'Reminder', emoji: '⏰' },
  { name: 'Note', emoji: '📝' },
];

const DEFAULT_STATUS_TAGS = [
  { name: 'Open', emoji: '📋' },
  { name: 'In Progress', emoji: '🔧' },
  { name: 'On Hold', emoji: '⏸️' },
  { name: 'Completed', emoji: '✅' },
];

export const memorySetupHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
) => {
  const startTime = Date.now();
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const guildId = interaction.guildId!;
  const _userId = interaction.user.id;

  // Rate limit check
  const rateLimitKey = createRateLimitKey.guild(guildId, 'memory-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.BOT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
    healthMonitor.recordCommand('memory-setup', Date.now() - startTime, true);
    return;
  }

  const existingConfig = await memoryConfigRepo.findOneBy({ guildId });
  const providedChannel = interaction.options.getChannel('channel') as ForumChannel | null;

  // If channel was provided directly, use it
  if (providedChannel) {
    await setupWithChannel(client, interaction, guildId, providedChannel, existingConfig);
    return;
  }

  // Show channel selection UI
  const isUpdate = !!existingConfig;

  const embed = new EmbedBuilder()
    .setTitle(`${E.config} ${tl.setup.title}`)
    .setDescription(tl.setup.description)
    .setColor(Colors.brand.primary);

  if (isUpdate && existingConfig) {
    embed.addFields({
      name: tl.setup.currentConfig,
      value: `${tl.setup.forumChannel}: <#${existingConfig.forumChannelId}>`,
    });
  }

  const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('memory_setup_channel')
      .setPlaceholder(tl.setup.channelPlaceholder)
      .setChannelTypes(ChannelType.GuildForum),
  );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('memory_setup_create_new')
      .setLabel(tl.setup.createNew)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('➕'),
    new ButtonBuilder()
      .setCustomId('memory_setup_cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  const response = await interaction.reply({
    embeds: [embed],
    components: [channelSelect, buttons],
    flags: [MessageFlags.Ephemeral],
  });

  try {
    const collector = response.createMessageComponentCollector({
      time: 120000,
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({
          content: 'This is not your interaction.',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (i.customId === 'memory_setup_cancel') {
        collector.stop('cancelled');
        await i.update({
          content: lang.errors.cancelled,
          embeds: [],
          components: [],
        });
        return;
      }

      if (i.customId === 'memory_setup_create_new') {
        collector.stop('creating');
        await i.update({
          content: `${E.loading} ${tl.setup.creatingForum}`,
          embeds: [],
          components: [],
        });

        // Create new forum channel
        const forum = await createMemoryForum(client, interaction, guildId, existingConfig);
        if (forum) {
          await i.editReply({
            content: `${E.success} ${tl.setup.configSaved}\n${tl.setup.forumChannel}: <#${forum.id}>`,
          });
        }
        return;
      }

      if (
        i.componentType === ComponentType.ChannelSelect &&
        i.customId === 'memory_setup_channel'
      ) {
        collector.stop('selected');
        const selectedChannel = i.channels.first() as ForumChannel;
        await i.update({
          content: `${E.loading} ${tl.setup.creatingForum}`,
          embeds: [],
          components: [],
        });
        await setupWithChannel(client, interaction, guildId, selectedChannel, existingConfig, i);
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
  } catch (error) {
    enhancedLogger.error(
      `Memory setup error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({
      content: `${E.error} ${tl.setup.error}`,
      embeds: [],
      components: [],
    });
  }
};

/**
 * Creates the welcome embed for the memory forum
 */
function createWelcomeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${E.memory || '📝'} ${tl.setup.welcomeTitle}`)
    .setDescription(tl.setup.welcomeDescription)
    .setColor(Colors.brand.primary)
    .setTimestamp();
}

/**
 * Deletes the old welcome thread if it exists
 */
async function deleteOldWelcomeThread(client: Client, config: MemoryConfig): Promise<void> {
  if (!config.messageId) return;

  try {
    const channel = (await client.channels.fetch(config.forumChannelId)) as ForumChannel;
    if (channel) {
      // messageId stores the thread ID for forum channels
      const thread = channel.threads.cache.get(config.messageId);
      if (thread) {
        await thread.delete();
      } else {
        // Try to fetch it if not in cache
        try {
          const fetchedThread = await channel.threads.fetch(config.messageId);
          if (fetchedThread) {
            await fetchedThread.delete();
          }
        } catch {
          // Thread may already be deleted
        }
      }
    }
  } catch {
    // Thread might already be deleted or channel inaccessible - that's fine
    enhancedLogger.warn(
      'Could not delete old memory welcome thread (may already be deleted)',
      LogCategory.COMMAND_EXECUTION,
    );
  }
}

/**
 * Creates a pinned welcome thread in the forum channel
 * Forum channels don't support regular messages, so we create a thread instead
 */
async function postWelcomeThread(forum: ForumChannel): Promise<string | null> {
  try {
    const embed = createWelcomeEmbed();

    // Create a forum post (thread) with the welcome message
    const thread = await forum.threads.create({
      name: `${E.memory || '📝'} ${tl.setup.welcomeTitle}`,
      message: { embeds: [embed] },
    });

    // Pin the forum post (thread.pin() pins it to top of forum, different from message.pin())
    try {
      await thread.pin();
    } catch {
      enhancedLogger.warn(
        'Could not pin memory welcome thread to forum',
        LogCategory.COMMAND_EXECUTION,
      );
    }

    return thread.id;
  } catch (error) {
    enhancedLogger.error(
      `Failed to create memory welcome thread: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
    );
    return null;
  }
}

async function setupWithChannel(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  channel: ForumChannel,
  existingConfig: MemoryConfig | null,
  componentInteraction?: any,
) {
  try {
    const isUpdate = !!existingConfig;

    // If updating to a different channel, delete the old welcome message
    if (existingConfig && existingConfig.forumChannelId !== channel.id) {
      await deleteOldWelcomeThread(client, existingConfig);
    }

    // Post and pin welcome message in the new channel
    const messageId = await postWelcomeThread(channel);

    // Create or update config
    let config = existingConfig;

    if (!config) {
      config = memoryConfigRepo.create({
        guildId,
        forumChannelId: channel.id,
        messageId,
      });
    } else {
      config.forumChannelId = channel.id;
      config.messageId = messageId;
    }

    await memoryConfigRepo.save(config);

    // Create default tags if first setup
    const existingTags = await memoryTagRepo.find({ where: { guildId } });
    if (existingTags.length === 0) {
      await createDefaultTags(guildId, channel);
    }

    const message = isUpdate ? tl.setup.configUpdated : tl.setup.configSaved;
    const content = `${E.success} ${message}\n${tl.setup.forumChannel}: <#${channel.id}>`;

    if (componentInteraction) {
      await componentInteraction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  } catch (error) {
    enhancedLogger.error(
      `Memory setup error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    const content = `${E.error} ${tl.setup.error}`;
    if (componentInteraction) {
      await componentInteraction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  }
}

async function createMemoryForum(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  existingConfig: MemoryConfig | null,
): Promise<ForumChannel | null> {
  try {
    const guild = interaction.guild!;

    // If updating, delete old welcome message first
    if (existingConfig) {
      await deleteOldWelcomeThread(client, existingConfig);
    }

    // Create the forum channel
    const forum = await guild.channels.create({
      name: tl.setup.forumName,
      type: ChannelType.GuildForum,
      topic: tl.setup.forumTopic,
    });

    // Post and pin welcome message
    const messageId = await postWelcomeThread(forum);

    // Save config
    let config = existingConfig;
    if (!config) {
      config = memoryConfigRepo.create({
        guildId,
        forumChannelId: forum.id,
        messageId,
      });
    } else {
      config.forumChannelId = forum.id;
      config.messageId = messageId;
    }
    await memoryConfigRepo.save(config);

    // Create default tags only if first setup
    const existingTags = await memoryTagRepo.find({ where: { guildId } });
    if (existingTags.length === 0) {
      await createDefaultTags(guildId, forum);
    }

    return forum;
  } catch (error) {
    enhancedLogger.error(
      `Failed to create memory forum: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({
      content: `${E.error} ${tl.setup.error}`,
    });
    return null;
  }
}

async function createDefaultTags(guildId: string, forum: ForumChannel) {
  const allTags: GuildForumTagData[] = [];
  const dbTags: Partial<MemoryTag>[] = [];

  // Add category tags
  for (const tag of DEFAULT_CATEGORY_TAGS) {
    allTags.push({
      name: tag.name,
      emoji: { id: null, name: tag.emoji },
    });
    dbTags.push({
      guildId,
      name: tag.name,
      emoji: tag.emoji,
      tagType: 'category' as MemoryTagType,
      isDefault: true,
    });
  }

  // Add status tags
  for (const tag of DEFAULT_STATUS_TAGS) {
    allTags.push({
      name: tag.name,
      emoji: { id: null, name: tag.emoji },
    });
    dbTags.push({
      guildId,
      name: tag.name,
      emoji: tag.emoji,
      tagType: 'status' as MemoryTagType,
      isDefault: true,
    });
  }

  // Update forum with tags
  const updatedForum = await forum.setAvailableTags(allTags);

  // Map Discord tag IDs to our database records
  for (const dbTag of dbTags) {
    const discordTag = updatedForum.availableTags.find(t => t.name === dbTag.name);
    if (discordTag) {
      dbTag.discordTagId = discordTag.id;
    }
  }

  // Save to database
  await memoryTagRepo.save(dbTags as MemoryTag[]);
}
