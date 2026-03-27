import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
  TextChannel,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { type BaitActionType, BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { enhancedLogger, handleInteractionError, LANGF, LogCategory, lang, safeDbOperation } from '../../../utils';
import { Colors } from '../../../utils/colors';

const tl = lang.baitChannel;

export const setupHandler = async (client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const channel = interaction.options.getChannel('channel', true);
    const gracePeriod = interaction.options.getInteger('grace_period', true);
    const action = interaction.options.getString('action', true);
    const logChannel = interaction.options.getChannel('log_channel');

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);

    let config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    // Track whether this is a new config or an update
    const isNewConfig = !config;
    let isChannelChange = false;

    if (!config) {
      config = configRepo.create({
        guildId: interaction.guildId!,
        channelId: channel.id,
        gracePeriodSeconds: gracePeriod,
        actionType: action as BaitActionType,
        logChannelId: logChannel?.id ?? null,
      });
    } else {
      // Check if channel is changing - if so, delete old message
      isChannelChange = config.channelId !== channel.id;

      if (isChannelChange && config.channelId && config.channelMessageId) {
        try {
          const oldChannel = await interaction.guild!.channels.fetch(config.channelId);
          if (oldChannel?.isTextBased()) {
            const oldMessage = await (oldChannel as TextChannel).messages.fetch(config.channelMessageId);
            await oldMessage.delete();
          }
        } catch {
          // Old channel/message may not exist anymore - that's fine
        }
        // Clear the old message ID since it's deleted or gone
        config.channelMessageId = null;
      }

      config.channelId = channel.id;
      config.gracePeriodSeconds = gracePeriod;
      config.actionType = action as BaitActionType;
      if (logChannel) config.logChannelId = logChannel.id;
    }

    await safeDbOperation(() => configRepo.save(config!), 'Save bait channel config');

    // Seed default keywords if this is a first-time setup (no keywords exist yet)
    try {
      const { seedDefaultKeywords } = await import('./keywords');
      const seeded = await seedDefaultKeywords(interaction.guildId!);
      if (seeded > 0) {
        enhancedLogger.info(
          `Seeded ${seeded} default keywords for guild ${interaction.guildId}`,
          LogCategory.COMMAND_EXECUTION,
        );
      }
    } catch {
      enhancedLogger.warn('Failed to seed default keywords during bait channel setup', LogCategory.COMMAND_EXECUTION);
    }

    // Send or update warning message in the BAIT CHANNEL (visible to everyone)
    if (channel instanceof TextChannel) {
      try {
        const warningContent =
          '# 🚨 **DO NOT POST HERE** 🚨\n\n' +
          'Not for fun. Not to "test" it. Not even as a joke.\n\n' +
          'This channel is monitored for bot detection.\n\n' +
          'If you post anything in here, our system will assume you are a bot and you **WILL BE BANNED**. No ifs, ands, or buts.\n\n' +
          'If you are a legitimate user, please do not post here. This is your only warning.';

        if (config.channelMessageId) {
          // Try to fetch and update existing message
          try {
            const existingMessage = await channel.messages.fetch(config.channelMessageId);
            await existingMessage.edit({ content: warningContent });
          } catch {
            // Message not found, send new one
            const msg = await channel.send({ content: warningContent });
            config.channelMessageId = msg.id;
            await configRepo.save(config);
          }
        } else {
          // First time setup - send new message and save ID
          const msg = await channel.send({ content: warningContent });
          config.channelMessageId = msg.id;
          await configRepo.save(config);
        }
      } catch {
        enhancedLogger.warn('Failed to send/update warning message to bait channel', LogCategory.COMMAND_EXECUTION);
      }
    }

    // Clear cache
    const { baitChannelManager } = client as ExtendedClient;
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(interaction.guildId!);
    }

    // Use "Updated" title if this is an existing config, "Configured" for new
    const embedTitle = isNewConfig ? tl.setup.title : tl.setup.titleUpdated;

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(embedTitle)
      .addFields(
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Grace Period', value: `${gracePeriod}s`, inline: true },
        { name: 'Action', value: action, inline: true },
      );

    if (logChannel) {
      embed.addFields({
        name: 'Log Channel',
        value: `✅ Set to <#${logChannel.id}>`,
      });
    }

    embed.setFooter({ text: tl.setup.footer });

    // Reply to the user with confirmation (ephemeral - only they can see it)
    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.setup);
  }
};

export const handleBaitChannelAddChannel = async (client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const channel = interaction.options.getChannel('channel', true);

    // Validate text channel
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Please select a text channel.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await interaction.reply({
        content: tl.setupFirst,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Build current channel list from channelIds or legacy channelId
    const currentChannels: string[] = config.channelIds?.length
      ? [...config.channelIds]
      : config.channelId
        ? [config.channelId]
        : [];

    // Validate max 3 channels
    if (currentChannels.length >= 3) {
      await interaction.reply({
        content: tl.multiChannel.maxReached,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check for duplicate
    if (currentChannels.includes(channel.id)) {
      await interaction.reply({
        content: LANGF(tl.multiChannel.alreadyAdded, channel.id),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Add channel
    currentChannels.push(channel.id);
    config.channelIds = currentChannels;
    // Keep legacy channelId in sync with first channel
    config.channelId = currentChannels[0];

    await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

    // Clear cache
    const { baitChannelManager } = client as ExtendedClient;
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(interaction.guildId!);
    }

    const channelList = currentChannels.map(id => `<#${id}>`).join(', ');
    const embed = new EmbedBuilder()
      .setColor(Colors.status.success)
      .setTitle(tl.multiChannel.title)
      .setDescription(LANGF(tl.multiChannel.added, channel.id))
      .addFields({
        name: tl.multiChannel.channelsLabel,
        value: channelList,
      });

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.addChannel);
  }
};

export const handleBaitChannelRemoveChannel = async (client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const channel = interaction.options.getChannel('channel', true);

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await interaction.reply({
        content: tl.setupFirst,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Build current channel list
    const currentChannels: string[] = config.channelIds?.length
      ? [...config.channelIds]
      : config.channelId
        ? [config.channelId]
        : [];

    // Must keep at least 1 channel
    if (currentChannels.length <= 1) {
      await interaction.reply({
        content: tl.multiChannel.mustKeepOne,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check channel is in the list
    if (!currentChannels.includes(channel.id)) {
      await interaction.reply({
        content: LANGF(tl.multiChannel.notInList, channel.id),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Remove channel
    const updatedChannels = currentChannels.filter(id => id !== channel.id);
    config.channelIds = updatedChannels;
    // Keep legacy channelId in sync with first channel
    config.channelId = updatedChannels[0];

    await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

    // Clear cache
    const { baitChannelManager } = client as ExtendedClient;
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(interaction.guildId!);
    }

    const channelList = updatedChannels.map(id => `<#${id}>`).join(', ');
    const embed = new EmbedBuilder()
      .setColor(Colors.status.success)
      .setTitle(tl.multiChannel.title)
      .setDescription(LANGF(tl.multiChannel.removed, channel.id))
      .addFields({
        name: tl.multiChannel.channelsLabel,
        value: channelList,
      });

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.removeChannel);
  }
};
