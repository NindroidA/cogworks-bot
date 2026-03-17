import fs from 'node:fs';
import type { Client, ForumChannel, ForumThreadChannel, GuildTextBasedChannel } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ArchivedTicket } from '../../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { fetchMessagesAndSaveToFile } from '../../fetchAllMessages';
import { applyForumTags, ensureForumTag } from '../../forumTagManager';
import { extractId, isValidSnowflake } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const ticketRepo = AppDataSource.getRepository(Ticket);
const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);
const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);
const customTicketTypeRepo = AppDataSource.getRepository(CustomTicketType);

export function registerTicketHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/tickets/:id/close
  routes.set('POST /tickets/:id/close', async (guildId, body, url) => {
    const ticketId = extractId(url, 'tickets');
    const ticket = await ticketRepo.findOneBy({ guildId, id: ticketId });
    if (!ticket) return { error: 'Ticket not found' };
    if (ticket.status === 'closed') return { error: 'Ticket already closed' };

    const archivedConfig = await archivedTicketConfigRepo.findOneBy({
      guildId,
    });
    if (!archivedConfig) return { error: 'Archive config not found' };

    // Mark closed immediately
    await ticketRepo.update({ id: ticket.id, guildId }, { status: 'closed' });

    // Get channel and generate transcript
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return { success: true, ticketId: ticket.id, archived: false };
    }

    const transcriptPath = process.env.TEMP_STORAGE_PATH || 'temp/';
    await fs.promises.mkdir(transcriptPath, { recursive: true });

    try {
      await fetchMessagesAndSaveToFile(channel as GuildTextBasedChannel, transcriptPath);
    } catch {
      return { success: true, ticketId: ticket.id, archived: false };
    }

    // Archive to forum
    try {
      const forumChannel = (await client.channels.fetch(archivedConfig.channelId)) as ForumChannel;
      const txtPath = `${transcriptPath}${ticket.channelId}.txt`;
      const zipPath = `${transcriptPath}attachments_${ticket.channelId}.zip`;
      const files = [txtPath];
      if (fs.existsSync(zipPath)) files.push(zipPath);

      // Get forum tags
      const forumTagIds: string[] = [];
      if (ticket.customTypeId) {
        const customType = await customTicketTypeRepo.findOne({
          where: { guildId, typeId: ticket.customTypeId },
        });
        if (customType) {
          const tagId = await ensureForumTag(
            forumChannel,
            customType.typeId,
            customType.displayName,
            customType.emoji,
          );
          if (tagId) forumTagIds.push(tagId);
        }
      }

      // Find or create archive thread
      const existingArchive =
        ticket.isEmailTicket && ticket.emailSender
          ? await archivedTicketRepo.findOneBy({
              emailSender: ticket.emailSender,
              guildId,
            })
          : await archivedTicketRepo.findOneBy({
              createdBy: ticket.createdBy,
              guildId,
            });

      if (!existingArchive) {
        let threadName: string;
        if (ticket.isEmailTicket && ticket.emailSender) {
          threadName = ticket.emailSenderName || ticket.emailSender.split('@')[0];
        } else {
          const user = await client.users.fetch(ticket.createdBy).catch(() => null);
          threadName = user?.username || 'Unknown';
        }

        const newPost = await forumChannel.threads.create({
          name: threadName,
          message: { files },
        });

        if (forumTagIds.length > 0) {
          await applyForumTags(forumChannel, newPost.id, forumTagIds);
        }

        await archivedTicketRepo.save(
          archivedTicketRepo.create({
            guildId,
            createdBy: ticket.createdBy,
            messageId: newPost.id,
            ticketType: ticket.type,
            customTypeId: ticket.customTypeId,
            forumTagIds,
            isEmailTicket: ticket.isEmailTicket || false,
            emailSender: ticket.emailSender,
            emailSenderName: ticket.emailSenderName,
            emailSubject: ticket.emailSubject,
          }),
        );
      } else {
        const post = (await forumChannel.threads.fetch(
          existingArchive.messageId,
        )) as ForumThreadChannel;
        await post.send({ files });
      }

      // Cleanup temp files
      await fs.promises.unlink(txtPath).catch(() => null);
      if (files.includes(zipPath)) {
        await fs.promises.unlink(zipPath).catch(() => null);
      }
    } catch {
      // Archive failed but ticket is still closed
    }

    // Delete ticket channel
    try {
      await (channel as GuildTextBasedChannel).delete();
    } catch {
      // Channel may already be deleted
    }

    await writeAuditLog(guildId, 'ticket.close', body.triggeredBy as string, {
      ticketId: ticket.id,
    });
    return { success: true, ticketId: ticket.id };
  });

  // POST /internal/guilds/:guildId/tickets/:id/assign
  routes.set('POST /tickets/:id/assign', async (guildId, body, url) => {
    const ticketId = extractId(url, 'tickets');
    const userId = body.userId as string;
    if (!userId) return { error: 'userId is required' };
    if (!isValidSnowflake(userId)) return { error: 'Invalid userId format' };

    const ticket = await ticketRepo.findOneBy({ guildId, id: ticketId });
    if (!ticket) return { error: 'Ticket not found' };

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { error: 'Guild not found' };

    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) return { error: 'Ticket channel not found' };

    // Add user to channel permissions
    if ('permissionOverwrites' in channel) {
      await channel.permissionOverwrites.create(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    }

    await writeAuditLog(guildId, 'ticket.assign', body.triggeredBy as string, {
      ticketId,
      userId,
    });
    return { success: true };
  });
}
