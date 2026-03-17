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
  type MessageComponentInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { AppDataSource } from '../../typeorm';
import {
  MemoryConfig,
  MemoryItem,
  MemoryTag,
  type MemoryTagType,
} from '../../typeorm/entities/memory';
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
const memoryItemRepo = AppDataSource.getRepository(MemoryItem);

const MAX_CHANNELS_PER_GUILD = 3;

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

export const memorySetupHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
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

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'setup':
      await handleSetup(client, interaction, guildId);
      break;
    case 'add-channel':
      await handleAddChannel(client, interaction, guildId);
      break;
    case 'remove-channel':
      await handleRemoveChannel(client, interaction, guildId);
      break;
    case 'view':
      await handleView(interaction, guildId);
      break;
  }
};

async function handleSetup(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
) {
  const existingConfigs = await memoryConfigRepo.find({ where: { guildId } });

  if (existingConfigs.length > 0) {
    await interaction.reply({
      content: `${E.info} ${tl.setup.alreadyConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const providedChannel = interaction.options.getChannel('channel') as ForumChannel | null;
  const channelName = interaction.options.getString('channel-name');

  if (providedChannel) {
    await setupWithChannel(client, interaction, guildId, providedChannel, channelName);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${E.config} ${tl.setup.title}`)
    .setDescription(tl.setup.description)
    .setColor(Colors.brand.primary);

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
      .setEmoji('\u2795'),
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
          content: lang.errors.notYourInteraction,
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

        const forum = await createMemoryForum(client, interaction, guildId, channelName);
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
        await setupWithChannel(client, interaction, guildId, selectedChannel, channelName, i);
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
}

async function handleAddChannel(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
) {
  const existingConfigs = await memoryConfigRepo.find({ where: { guildId } });

  if (existingConfigs.length >= MAX_CHANNELS_PER_GUILD) {
    await interaction.reply({
      content: `${E.error} ${tl.setup.maxChannelsReached}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true) as ForumChannel;
  const channelName = interaction.options.getString('channel-name') || channel.name;

  const alreadyUsed = existingConfigs.some(c => c.forumChannelId === channel.id);
  if (alreadyUsed) {
    await interaction.reply({
      content: `${E.error} ${tl.setup.channelAlreadyUsed}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const nextSortOrder =
      existingConfigs.length > 0 ? Math.max(...existingConfigs.map(c => c.sortOrder)) + 1 : 0;

    const messageId = await postWelcomeThread(channel);

    const config = memoryConfigRepo.create({
      guildId,
      forumChannelId: channel.id,
      channelName,
      messageId,
      sortOrder: nextSortOrder,
    });
    await memoryConfigRepo.save(config);

    await createDefaultTags(guildId, config.id, channel);

    await interaction.editReply({
      content: `${E.success} ${tl.setup.channelAdded}\n${tl.setup.forumChannel}: <#${channel.id}>`,
    });
  } catch (error) {
    enhancedLogger.error(
      `Memory add-channel error: ${error}`,
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({ content: `${E.error} ${tl.setup.error}` });
  }
}

async function handleRemoveChannel(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
) {
  const configs = await memoryConfigRepo.find({
    where: { guildId },
    order: { sortOrder: 'ASC' },
  });

  if (configs.length === 0) {
    await interaction.reply({
      content: `${E.error} ${tl.setup.viewNoChannels}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_remove_channel_select')
      .setPlaceholder(tl.setup.selectChannelToRemove)
      .addOptions(
        configs.map(c => ({
          label: c.channelName,
          value: c.id.toString(),
          description: `Forum: <#${c.forumChannelId}>`,
        })),
      ),
  );

  const response = await interaction.reply({
    content: `${E.warning} ${tl.setup.selectChannelToRemove}`,
    components: [selectMenu],
    flags: [MessageFlags.Ephemeral],
  });

  try {
    const i = await response.awaitMessageComponent({
      filter: i =>
        i.user.id === interaction.user.id && i.customId === 'memory_remove_channel_select',
      time: 30000,
    });

    if (!i.isStringSelectMenu()) return;

    const selectedId = Number.parseInt(i.values[0], 10);
    const config = configs.find(c => c.id === selectedId);
    if (!config) return;

    const isLast = configs.length === 1;
    const warningText = isLast
      ? `${tl.setup.removeConfirm}\n\n\u26A0\uFE0F ${tl.setup.removeLastWarning}`
      : tl.setup.removeConfirm;

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('memory_remove_confirm')
        .setLabel(lang.general.buttons.confirm)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('memory_remove_cancel')
        .setLabel(lang.general.buttons.cancel)
        .setStyle(ButtonStyle.Secondary),
    );

    await i.update({
      content: `${E.warning} ${warningText}\n\n**${tl.setup.channelNameLabel}:** ${config.channelName}\n**${tl.setup.forumChannel}:** <#${config.forumChannelId}>`,
      components: [confirmRow],
    });

    const confirmI = await i.message.awaitMessageComponent({
      filter: ci => ci.user.id === interaction.user.id,
      time: 30000,
    });

    if (confirmI.customId === 'memory_remove_cancel') {
      await confirmI.update({ content: lang.errors.cancelled, components: [] });
      return;
    }

    if (confirmI.customId === 'memory_remove_confirm') {
      await confirmI.update({
        content: `${E.loading} Processing...`,
        components: [],
      });

      try {
        await deleteOldWelcomeThread(client, config);
        await memoryItemRepo.delete({ guildId, memoryConfigId: config.id });
        await memoryTagRepo.delete({ guildId, memoryConfigId: config.id });
        await memoryConfigRepo.remove(config);

        await confirmI.editReply({
          content: `${E.success} ${tl.setup.channelRemoved}`,
        });
      } catch (error) {
        enhancedLogger.error(
          `Memory remove-channel error: ${error}`,
          error instanceof Error ? error : undefined,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
        await confirmI.editReply({ content: `${E.error} ${tl.setup.error}` });
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

async function handleView(interaction: ChatInputCommandInteraction, guildId: string) {
  const configs = await memoryConfigRepo.find({
    where: { guildId },
    order: { sortOrder: 'ASC' },
  });

  if (configs.length === 0) {
    await interaction.reply({
      content: `${E.info} ${tl.setup.viewNoChannels}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${E.memory} ${tl.setup.viewTitle}`)
    .setColor(Colors.brand.primary);

  for (const config of configs) {
    const tagCount = await memoryTagRepo.count({
      where: { guildId, memoryConfigId: config.id },
    });
    const itemCount = await memoryItemRepo.count({
      where: { guildId, memoryConfigId: config.id },
    });

    embed.addFields({
      name: config.channelName,
      value: `${tl.setup.forumChannel}: <#${config.forumChannelId}>\nTags: ${tagCount} | Items: ${itemCount}`,
    });
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

function createWelcomeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${E.memory || '\u{1F4DD}'} ${tl.setup.welcomeTitle}`)
    .setDescription(tl.setup.welcomeDescription)
    .setColor(Colors.brand.primary)
    .setTimestamp();
}

async function deleteOldWelcomeThread(client: Client, config: MemoryConfig): Promise<void> {
  if (!config.messageId) return;

  try {
    const channel = (await client.channels.fetch(config.forumChannelId)) as ForumChannel;
    if (channel) {
      const thread = channel.threads.cache.get(config.messageId);
      if (thread) {
        await thread.delete();
      } else {
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
    enhancedLogger.warn(
      'Could not delete old memory welcome thread (may already be deleted)',
      LogCategory.COMMAND_EXECUTION,
    );
  }
}

async function postWelcomeThread(forum: ForumChannel): Promise<string | null> {
  try {
    const embed = createWelcomeEmbed();

    const thread = await forum.threads.create({
      name: `${E.memory || '\u{1F4DD}'} ${tl.setup.welcomeTitle}`,
      message: { embeds: [embed] },
    });

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
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  channel: ForumChannel,
  channelName: string | null,
  componentInteraction?: MessageComponentInteraction,
) {
  try {
    const messageId = await postWelcomeThread(channel);

    const config = memoryConfigRepo.create({
      guildId,
      forumChannelId: channel.id,
      channelName: channelName || channel.name,
      messageId,
      sortOrder: 0,
    });
    await memoryConfigRepo.save(config);

    await createDefaultTags(guildId, config.id, channel);

    const content = `${E.success} ${tl.setup.configSaved}\n${tl.setup.forumChannel}: <#${channel.id}>`;

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
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  channelName: string | null,
): Promise<ForumChannel | null> {
  try {
    const guild = interaction.guild!;

    const forum = await guild.channels.create({
      name: tl.setup.forumName,
      type: ChannelType.GuildForum,
      topic: tl.setup.forumTopic,
    });

    const messageId = await postWelcomeThread(forum);

    const config = memoryConfigRepo.create({
      guildId,
      forumChannelId: forum.id,
      channelName: channelName || forum.name,
      messageId,
      sortOrder: 0,
    });
    await memoryConfigRepo.save(config);

    await createDefaultTags(guildId, config.id, forum);

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

async function createDefaultTags(guildId: string, configId: number, forum: ForumChannel) {
  const allTags: GuildForumTagData[] = [];
  const dbTags: Partial<MemoryTag>[] = [];

  for (const tag of DEFAULT_CATEGORY_TAGS) {
    allTags.push({
      name: tag.name,
      emoji: { id: null, name: tag.emoji },
    });
    dbTags.push({
      guildId,
      memoryConfigId: configId,
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
      memoryConfigId: configId,
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
