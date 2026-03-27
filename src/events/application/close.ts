import fs from 'node:fs';
import {
  type ButtonInteraction,
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
import { fetchMessagesAndSaveToFile } from '../../utils/fetchAllMessages';

const tl = lang.application.close;
const applicationRepo = lazyRepo(Application);
const archivedApplicationRepo = lazyRepo(ArchivedApplication);
const archivedApplicationConfigRepo = lazyRepo(ArchivedApplicationConfig);

export const applicationCloseEvent = async (client: Client, interaction: ButtonInteraction) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const channel = interaction.channel as GuildTextBasedChannel; // text channel the event was initiated
  const channelId = interaction.channelId || '';
  const transcriptPath = process.env.TEMP_STORAGE_PATH || 'temp/'; // path to temporarily save transcripts
  const archivedConfig = await archivedApplicationConfigRepo.findOneBy({
    guildId,
  }); // get the archived application config by guildId
  const application = await applicationRepo.findOneBy({
    guildId,
    channelId: channelId,
  }); // get the application this event was initiated from the Application database using channelId

  // check if the archived application config exists
  if (!archivedConfig) {
    enhancedLogger.warn(lang.application.applicationConfigNotFound, LogCategory.SYSTEM, {
      guildId,
    });
    return;
  }

  // check if the application exists
  if (!application) {
    enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
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

  // Immediately mark as closed to prevent concurrent close attempts
  await applicationRepo.update({ id: application.id, guildId }, { status: 'closed' });

  // get archive channel from ArchivedApplication db using createdBy AND guildId (CRITICAL: must be guild-scoped!)
  const createdBy = application.createdBy;
  const transcriptChannel = await archivedApplicationRepo.findOneBy({
    createdBy: createdBy,
    guildId: guildId, // CRITICAL: Filter by guild to prevent cross-server issues
  });

  // ensure the transcript directory exists
  await fs.promises.mkdir(transcriptPath, { recursive: true });

  // make the transcript file
  try {
    await fetchMessagesAndSaveToFile(channel, transcriptPath);
  } catch (error) {
    enhancedLogger.error('Failed to create application transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    // Only reply if we haven't already replied/deferred
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: tl.transcriptCreate.error,
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  // send the transcript file
  try {
    const forumId = archivedConfig.channelId; // channelId of the archive forum channel
    const forumChannel = (await client.channels.fetch(forumId)) as ForumChannel; // the actual archive forum channel
    const txtPath = `${transcriptPath}${channelId}.txt`;
    const zipPath = `${transcriptPath}attachments_${channelId}.zip`;
    let zipCheck: boolean = false; // flag check to see if we have a zip file for attachments
    const files = [txtPath];

    // if we have attachments, add them to the files array
    if (fs.existsSync(zipPath)) {
      files.push(zipPath);
      enhancedLogger.debug(tl.transcriptCreate.attachmentFound, LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
      zipCheck = true;
    } else {
      enhancedLogger.debug(tl.transcriptCreate.attachmentNotFound, LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    }

    // if transcript channel doesn't exist, make one and put the transcript
    if (!transcriptChannel) {
      const archiveUser = client.users.fetch(createdBy); // the user to archive (user who created the original application)

      // make the new thread with the transcript
      const newPost = await forumChannel.threads.create({
        name: (await archiveUser).username,
        message: {
          files: files,
        },
      });

      // create archived application in database
      const newArchivedApplication = archivedApplicationRepo.create({
        guildId: guildId,
        createdBy: application.createdBy,
        messageId: newPost.id,
      });

      //save to database
      await archivedApplicationRepo.save(newArchivedApplication);

      // if transcript channel DOES exist, just add the transcript to the channel
    } else if (transcriptChannel.messageId) {
      const existMsg = transcriptChannel.messageId; // existing message in the thread
      const post = (await forumChannel.threads.fetch(existMsg)) as ForumThreadChannel; // existing thread
      await post.send({ files: files });
    }

    // delete the saved txt file
    try {
      await fs.promises.unlink(txtPath);
    } catch (error) {
      enhancedLogger.error('Failed to delete application transcript file', error as Error, LogCategory.SYSTEM, {
        guildId,
        txtPath,
      });
    }

    if (zipCheck) {
      // delete the saved zip file
      try {
        await fs.promises.unlink(zipPath);
      } catch (error) {
        enhancedLogger.error('Failed to delete application attachment zip', error as Error, LogCategory.SYSTEM, {
          guildId,
          zipPath,
        });
      }
    }
  } catch (error) {
    enhancedLogger.error('Failed to send application transcript', error as Error, LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return;
  }

  // log success message
  enhancedLogger.info('Application transcript archived successfully', LogCategory.SYSTEM, {
    guildId,
    channelId,
  });

  // delete the channel (verified — logs failure instead of throwing)
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
