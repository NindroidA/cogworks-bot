import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  type Guild,
  MessageFlags,
  TextChannel,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { type BaitActionType, BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import {
  enhancedLogger,
  fmt,
  getBaitChannelIds,
  handleInteractionError,
  LogCategory,
  lang,
  replyEphemeralError,
  safeDbOperation,
  setBaitChannels,
  verifiedMessageDeleteById,
} from '../../../utils';
import { Colors } from '../../../utils/colors';
import { BAIT_CHANNEL_WARNING } from '../../../utils/setup/channelDefaults';

const tl = lang.baitChannel;

export async function setupHandler(client: Client, interaction: ChatInputCommandInteraction) {
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
        gracePeriodSeconds: gracePeriod,
        actionType: action as BaitActionType,
        logChannelId: logChannel?.id ?? null,
      });
      setBaitChannels(config, [channel.id]);
    } else {
      const currentChannels = getBaitChannelIds(config);
      const oldPrimary = currentChannels[0];
      // The warning banner lives in the channel the LEGACY channelId column
      // points at — every writer posts it there, including the pre-v3.15.3
      // setup whose legacy-only writes created divergent rows. Key the
      // banner's delete/keep decision off that column, not the effective-list
      // primary: on a divergent row they differ, and using the list primary
      // would orphan the old banner and post a duplicate.
      const bannerHome = config.channelId || oldPrimary;
      isChannelChange = bannerHome !== channel.id;

      if (isChannelChange && bannerHome && config.channelMessageId) {
        try {
          const oldChannel = await interaction.guild!.channels.fetch(bannerHome);
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

      // Replace the primary but preserve any extra channels added via
      // `/baitchannel channels add` (dedupe, max 3 enforced by add handler)
      setBaitChannels(config, [channel.id, ...currentChannels.filter(id => id !== oldPrimary)].slice(0, 3));
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
        const warningContent = BAIT_CHANNEL_WARNING;

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
}

export async function handleBaitChannelAddChannel(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const channel = interaction.options.getChannel('channel', true);

    // Validate text channel
    if (channel.type !== ChannelType.GuildText) {
      await replyEphemeralError(interaction, lang.baitChannel.setup.textChannelRequired);
      return;
    }

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await replyEphemeralError(interaction, tl.setupFirst);
      return;
    }

    const currentChannels = getBaitChannelIds(config);

    // Validate max 3 channels
    if (currentChannels.length >= 3) {
      await replyEphemeralError(interaction, tl.multiChannel.maxReached);
      return;
    }

    // Check for duplicate
    if (currentChannels.includes(channel.id)) {
      await replyEphemeralError(interaction, fmt(tl.multiChannel.alreadyAdded, { channelId: channel.id }));
      return;
    }

    // Add channel
    currentChannels.push(channel.id);
    setBaitChannels(config, currentChannels);

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
      .setDescription(fmt(tl.multiChannel.added, { channelId: channel.id }))
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
}

export async function handleBaitChannelRemoveChannel(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const channel = interaction.options.getChannel('channel', true);

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await replyEphemeralError(interaction, tl.setupFirst);
      return;
    }

    const currentChannels = getBaitChannelIds(config);

    // Must keep at least 1 channel
    if (currentChannels.length <= 1) {
      await replyEphemeralError(interaction, tl.multiChannel.mustKeepOne);
      return;
    }

    // Check channel is in the list
    if (!currentChannels.includes(channel.id)) {
      await replyEphemeralError(interaction, fmt(tl.multiChannel.notInList, { channelId: channel.id }));
      return;
    }

    // Remove channel. The warning banner lives in the legacy channelId
    // column's channel (see channelList.ts), so removing that channel moves
    // the banner to the new primary. The reference is cleared and saved
    // BEFORE the old banner is deleted: messageDelete's cleanup then finds
    // nothing to clear, instead of saving its stale copy over this change.
    const bannerHome = config.channelId;
    const oldBannerId = channel.id === bannerHome ? config.channelMessageId : null;
    const updatedChannels = currentChannels.filter(id => id !== channel.id);
    setBaitChannels(config, updatedChannels);
    if (oldBannerId) config.channelMessageId = null;

    await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

    const bannerLeft = oldBannerId ? !(await moveBanner(interaction.guild!, config, bannerHome, oldBannerId)) : false;

    // Clear cache
    const { baitChannelManager } = client as ExtendedClient;
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(interaction.guildId!);
    }

    const channelList = updatedChannels.map(id => `<#${id}>`).join(', ');
    const embed = new EmbedBuilder()
      .setColor(Colors.status.success)
      .setTitle(tl.multiChannel.title)
      .setDescription(
        bannerLeft
          ? `${fmt(tl.multiChannel.removed, { channelId: channel.id })}\n\n${fmt(tl.multiChannel.bannerDeleteFailed, { channelId: channel.id })}`
          : fmt(tl.multiChannel.removed, { channelId: channel.id }),
      )
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
}

/**
 * Move the warning banner out of a removed bait channel: delete it there,
 * then post it in the new primary (`config.channelId`) and save its ID.
 * Returns false when the old banner couldn't be deleted.
 */
async function moveBanner(
  guild: Guild,
  config: BaitChannelConfig,
  oldChannelId: string,
  oldMessageId: string,
): Promise<boolean> {
  const configRepo = AppDataSource.getRepository(BaitChannelConfig);
  const oldChannel = await guild.channels.fetch(oldChannelId).catch(() => null);
  const deleted = oldChannel?.isTextBased()
    ? (await verifiedMessageDeleteById(oldChannel, oldMessageId, { guildId: guild.id, label: 'bait warning banner' }))
        .success
    : false;

  try {
    const newHome = await guild.channels.fetch(config.channelId);
    if (newHome?.isTextBased()) {
      const msg = await newHome.send({ content: BAIT_CHANNEL_WARNING });
      config.channelMessageId = msg.id;
      await configRepo.save(config);
    }
  } catch (error) {
    enhancedLogger.warn('Failed to post the bait warning banner in the new primary', LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      channelId: config.channelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return deleted;
}
