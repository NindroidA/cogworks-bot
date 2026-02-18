import fs from 'node:fs';
import {
  type ButtonInteraction,
  type Client,
  type ForumChannel,
  type ForumThreadChannel,
  type GuildTextBasedChannel,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { Application } from '../../typeorm/entities/application/Application';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { lang, logger } from '../../utils';
import { fetchMessagesAndSaveToFile } from '../../utils/fetchAllMessages';

const tl = lang.application.close;
const applicationRepo = AppDataSource.getRepository(Application);
const archivedApplicationRepo = AppDataSource.getRepository(ArchivedApplication);
const archivedApplicationConfigRepo = AppDataSource.getRepository(ArchivedApplicationConfig);

export const applicationCloseEvent = async (client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId || ''; // guild where the event was initiated
  const channel = interaction.channel as GuildTextBasedChannel; // text channel the event was initiated
  const channelId = interaction.channelId || '';
  const transcriptPath = process.env.TEMP_STORAGE_PATH || 'temp/'; // path to temporarily save transcripts
  const archivedConfig = await archivedApplicationConfigRepo.findOneBy({ guildId }); // get the archived application config by guildId
  const application = await applicationRepo.findOneBy({ channelId: channelId }); // get the application this event was initiated from the Application database using channelId

  // check if the archived application config exists
  if (!archivedConfig) {
    return logger(lang.application.applicationConfigNotFound);
  }

  // check if the application exists
  if (!application) {
    return logger(lang.general.fatalError, 'ERROR');
  }

  // get archive channel from ArchivedApplication db using createdBy AND guildId (CRITICAL: must be guild-scoped!)
  const createdBy = application.createdBy;
  const transcriptChannel = await archivedApplicationRepo.findOneBy({
    createdBy: createdBy,
    guildId: guildId, // CRITICAL: Filter by guild to prevent cross-server issues
  });

  // ensure the transcript directory exists
  if (!fs.existsSync(transcriptPath)) {
    fs.mkdirSync(transcriptPath, { recursive: true });
    logger(`Created transcript directory: ${transcriptPath}`);
  }

  // make the transcript file
  try {
    await fetchMessagesAndSaveToFile(channel, transcriptPath);
  } catch (error) {
    logger(tl.transcriptCreate.error + error, 'ERROR');
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
      logger(tl.transcriptCreate.attachmentFound);
      zipCheck = true;
    } else {
      logger(tl.transcriptCreate.attachmentNotFound);
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
    } else {
      const existMsg = transcriptChannel.messageId; // existing message in the thread
      const post = (await forumChannel.threads.fetch(existMsg)) as ForumThreadChannel; // existing thread
      await post.send({ files: files });
    }

    // delete the saved txt file
    fs.unlink(txtPath, error => {
      if (error) logger(tl.transcriptDelete.error1 + error, 'ERROR');
    });

    if (zipCheck) {
      // delete the saved zip file
      fs.unlink(zipPath, error => {
        if (error) logger(tl.transcriptDelete.attachmentError + error, 'ERROR');
      });
    }
  } catch (error) {
    return logger(tl.transcriptDelete.error2 + error, 'ERROR');
  }

  // update the application status
  await applicationRepo.update({ id: application.id }, { status: 'closed' });

  // log success message
  logger(tl.transcriptCreate.success);

  // delete the channel
  await channel.delete(application.channelId);
};
