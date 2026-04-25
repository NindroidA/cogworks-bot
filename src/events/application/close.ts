import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  type ForumChannel,
  type ForumThreadChannel,
  type GuildTextBasedChannel,
  MessageFlags,
} from 'discord.js';
import { Application } from '../../typeorm/entities/application/Application';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { enhancedLogger, LogCategory, lang, verifiedChannelDelete } from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';
import { fetchMessagesAsTranscript } from '../../utils/fetchAllMessages';
import { buildTranscript, type TicketMetadata, type TranscriptMessage } from '../../utils/ticket/transcriptBuilder';

const tl = lang.application.close;
const applicationRepo = lazyRepo(Application);
const archivedApplicationRepo = lazyRepo(ArchivedApplication);
const archivedApplicationConfigRepo = lazyRepo(ArchivedApplicationConfig);

export const applicationCloseEvent = async (client: Client, interaction: ButtonInteraction) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const channel = interaction.channel as GuildTextBasedChannel;
  const channelId = interaction.channelId || '';
  const archivedConfig = await archivedApplicationConfigRepo.findOneBy({
    guildId,
  });
  const application = await applicationRepo.findOneBy({ guildId, channelId });

  if (!archivedConfig) {
    enhancedLogger.warn(lang.application.applicationConfigNotFound, LogCategory.SYSTEM, { guildId });
    return;
  }

  if (!application) {
    enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.SYSTEM, { guildId, channelId });
    return;
  }

  // Prevent duplicate close (double-click race condition)
  if (application.status === 'closed') {
    enhancedLogger.warn('Application already closed, skipping duplicate archive', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return;
  }

  await applicationRepo.update({ id: application.id, guildId }, { status: 'closed' });

  const createdBy = application.createdBy;
  const existingArchive = await archivedApplicationRepo.findOneBy({
    createdBy,
    guildId,
  });

  // Fetch messages into the pure transcript shape.
  let transcriptMessages: TranscriptMessage[];
  try {
    transcriptMessages = await fetchMessagesAsTranscript(channel, client.user?.id ?? '');
  } catch (error) {
    enhancedLogger.error('Failed to fetch application messages for transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: tl.transcriptCreate.error,
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  const creatorUser = await client.users.fetch(createdBy).catch(() => null);
  const metadata: TicketMetadata = {
    title: `Application: ${creatorUser?.username || 'Unknown'}`,
    type: 'Application',
    createdByUsername: creatorUser?.username || 'Unknown',
    openedAt: 'createdAt' in channel && channel.createdAt instanceof Date ? channel.createdAt : new Date(),
    closedAt: new Date(),
    assignedToUsername: null,
  };

  const transcript = buildTranscript(transcriptMessages, metadata);

  try {
    const forumChannel = (await client.channels.fetch(archivedConfig.channelId)) as ForumChannel;

    if (!existingArchive) {
      const archiveUser = await client.users.fetch(createdBy).catch(() => null);
      const newPost = await forumChannel.threads.create({
        name: archiveUser?.username || 'Unknown',
        message: { content: transcript.header },
      });

      for (const chunk of transcript.chunks) {
        await newPost.send({ content: chunk });
      }

      await archivedApplicationRepo.save(
        archivedApplicationRepo.create({
          guildId,
          createdBy: application.createdBy,
          messageId: newPost.id,
        }),
      );
    } else if (existingArchive.messageId) {
      const post = (await forumChannel.threads.fetch(existingArchive.messageId)) as ForumThreadChannel;
      const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
      await post.send({ content: separator + transcript.header });
      for (const chunk of transcript.chunks) {
        await post.send({ content: chunk });
      }
    }
  } catch (error) {
    enhancedLogger.error('Failed to post application transcript to forum', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return;
  }

  enhancedLogger.info('Application transcript archived successfully', LogCategory.SYSTEM, {
    guildId,
    channelId,
    messageCount: transcript.messageCount,
    attachmentCount: transcript.attachmentCount,
  });

  const deleteResult = await verifiedChannelDelete(channel, {
    guildId,
    label: 'application channel',
  });
  if (!deleteResult.success) {
    enhancedLogger.error(
      `Application channel persisted after delete attempt — possible bug. Channel: ${channelId}`,
      undefined,
      LogCategory.ERROR,
      {
        guildId,
        channelId,
        error: deleteResult.error,
      },
    );
  }
};

export const closeApplicationButton = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: close_application`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('confirm_close_application').setLabel(tl.closingL).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_close_application').setLabel(tl.cancelL).setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: tl.confirm,
    components: [confirmRow],
    flags: [MessageFlags.Ephemeral],
  });
};

export const confirmCloseApplication = async (client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: confirm_close_application`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.closing, components: [] });
  await applicationCloseEvent(client, interaction);
};

export const cancelCloseApplication = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: cancel_close_application`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.cancel, components: [] });
};
