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
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import {
  applyForumTags,
  enhancedLogger,
  ensureForumTag,
  LogCategory,
  lang,
  logger,
} from '../../utils';
import { fetchMessagesAndSaveToFile } from '../../utils/fetchAllMessages';

const tl = lang.ticket.close;
const ticketRepo = AppDataSource.getRepository(Ticket);
const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);
const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);
const customTicketTypeRepo = AppDataSource.getRepository(CustomTicketType);

export const ticketCloseEvent = async (client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId || ''; // guild where the event was initiated
  const channel = interaction.channel as GuildTextBasedChannel; // text channel the event was initiated
  const channelId = interaction.channelId || '';
  const transcriptPath = process.env.TEMP_STORAGE_PATH || 'temp/'; // path to temporarily save transcripts
  const archivedConfig = await archivedTicketConfigRepo.findOneBy({ guildId }); // get the archived ticket config by guildId
  const ticket = await ticketRepo.findOneBy({ channelId: channelId }); // // get the ticket this event was initiated from the Ticket database using channelId

  // check if the archived ticket config exists
  if (!archivedConfig) {
    return logger(lang.ticket.archiveTicketConfigNotFound);
  }

  // check if the ticket exists
  if (!ticket) {
    return logger(lang.general.fatalError, 'ERROR');
  }

  // get archived channel from ArchivedTicket database using createdBy AND guildId (CRITICAL: must be guild-scoped!)
  const createdBy = ticket.createdBy;
  const transcriptChannel = await archivedTicketRepo.findOneBy({
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

    // Get ticket type info FIRST (needed for both new and existing posts)
    let typeId: string | null = null;
    let displayName: string | null = null;
    let emoji: string | null = null;

    enhancedLogger.debug('Forum tag: ticket data', LogCategory.COMMAND_EXECUTION, {
      customTypeId: ticket.customTypeId,
      type: ticket.type,
      ticketId: ticket.id,
    });

    if (ticket.customTypeId) {
      // Custom ticket type - fetch from database
      const customType = await customTicketTypeRepo.findOne({
        where: { guildId, typeId: ticket.customTypeId },
      });

      enhancedLogger.debug('Forum tag: custom type lookup', LogCategory.COMMAND_EXECUTION, {
        customType,
      });

      if (customType) {
        typeId = customType.typeId;
        displayName = customType.displayName;
        emoji = customType.emoji;
      }
    } else if (ticket.type) {
      // Legacy ticket type - use type field directly
      typeId = ticket.type;

      // Map legacy type IDs to display names
      const legacyTypeMap: Record<string, { display: string; emoji: string }> = {
        '18_verify': { display: '18+ Verification', emoji: '🔞' },
        ban_appeal: { display: 'Ban Appeal', emoji: '⚖️' },
        player_report: { display: 'Player Report', emoji: '📢' },
        bug_report: { display: 'Bug Report', emoji: '🐛' },
        other: { display: 'Other', emoji: '❓' },
      };

      const legacyInfo = legacyTypeMap[ticket.type];
      if (legacyInfo) {
        displayName = legacyInfo.display;
        emoji = legacyInfo.emoji;
      }

      enhancedLogger.debug('Forum tag: legacy type info', LogCategory.COMMAND_EXECUTION, {
        typeId,
        displayName,
        emoji,
      });
    }

    enhancedLogger.debug('Forum tag: final type info', LogCategory.COMMAND_EXECUTION, {
      typeId,
      displayName,
      emoji,
    });

    // Prepare forum tags (will be applied to new or existing post)
    const forumTagIds: string[] = [];
    let tagId: string | null = null;

    if (typeId && displayName) {
      enhancedLogger.debug('Forum tag: creating/finding tag', LogCategory.COMMAND_EXECUTION, {
        typeId,
        displayName,
      });
      tagId = await ensureForumTag(forumChannel, typeId, displayName, emoji || null);

      enhancedLogger.debug('Forum tag: got tag ID', LogCategory.COMMAND_EXECUTION, { tagId });

      if (tagId) {
        forumTagIds.push(tagId);
      }
    } else {
      enhancedLogger.debug('Forum tag: missing required data', LogCategory.COMMAND_EXECUTION, {
        typeId,
        displayName,
      });
    }

    // if transcript channel doesn't exist, make one and put the transcript
    if (!transcriptChannel) {
      enhancedLogger.debug(
        'Forum tag: creating new post for first-time close',
        LogCategory.COMMAND_EXECUTION,
        { guildId },
      );
      const archiveUser = client.users.fetch(createdBy); // the user to archive (user who created the original ticket)

      // make the new thread with the transcript
      const newPost = await forumChannel.threads.create({
        name: (await archiveUser).username,
        message: {
          files: files,
        },
      });

      // Apply forum tags to the new post
      if (forumTagIds.length > 0) {
        enhancedLogger.debug(
          'Forum tag: applying tags to new post',
          LogCategory.COMMAND_EXECUTION,
          { postId: newPost.id, tagIds: forumTagIds },
        );
        await applyForumTags(forumChannel, newPost.id, forumTagIds);
      }

      // create archived ticket in database with all custom type data
      const newArchivedTicket = archivedTicketRepo.create({
        guildId: guildId,
        createdBy: ticket.createdBy,
        messageId: newPost.id,
        // Store legacy type for backward compatibility
        ticketType: ticket.type,
        // Store custom type data
        customTypeId: ticket.customTypeId,
        forumTagIds: forumTagIds,
        // Store email ticket data if applicable
        isEmailTicket: ticket.isEmailTicket || false,
        emailSender: ticket.emailSender,
        emailSenderName: ticket.emailSenderName,
        emailSubject: ticket.emailSubject,
      });

      //save to database
      await archivedTicketRepo.save(newArchivedTicket);
      // if transcript channel DOES exist, just add the transcript to the channel
    } else {
      enhancedLogger.debug(
        'Forum tag: adding transcript to existing thread',
        LogCategory.COMMAND_EXECUTION,
        { messageId: transcriptChannel.messageId },
      );
      const existMsg = transcriptChannel.messageId; // existing message in the thread
      const post = (await forumChannel.threads.fetch(existMsg)) as ForumThreadChannel; // existing thread
      await post.send({ files: files });

      // Apply forum tags to EXISTING post (merge with existing tags)
      if (forumTagIds.length > 0) {
        // Get existing tags from database
        const existingTags = transcriptChannel.forumTagIds || [];
        const newTagId = forumTagIds[0];

        // Check if post already has this specific tag
        if (!existingTags.includes(newTagId)) {
          // Merge new tag with existing tags (add, don't replace)
          const mergedTags = [...existingTags, newTagId];

          enhancedLogger.debug(
            'Forum tag: adding tag to existing post',
            LogCategory.COMMAND_EXECUTION,
            { postId: existMsg, existingTags, newTag: newTagId, mergedTags },
          );

          await applyForumTags(forumChannel, existMsg, mergedTags);

          // Update database with merged tags
          transcriptChannel.forumTagIds = mergedTags;
          await archivedTicketRepo.save(transcriptChannel);
        } else {
          enhancedLogger.debug(
            'Forum tag: post already has this tag, skipping',
            LogCategory.COMMAND_EXECUTION,
          );
        }
      }
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

  // update the ticket status
  await ticketRepo.update({ id: ticket.id }, { status: 'closed' });

  // log success message
  logger(tl.transcriptCreate.success);

  // delete the channel
  await channel.delete(ticket.channelId);
};
