import type { Client, ForumChannel, ForumThreadChannel, GuildTextBasedChannel } from 'discord.js';
import { Application } from '../../../typeorm/entities/application/Application';
import { ArchivedApplication } from '../../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { lazyRepo } from '../../database/lazyRepo';
import { verifiedChannelDelete } from '../../discord/verifiedDelete';
import { fetchMessagesAsTranscript } from '../../fetchAllMessages';
import { enhancedLogger, LogCategory } from '../../monitoring/enhancedLogger';
import { buildTranscript, type TicketMetadata, type TranscriptMessage } from '../../ticket/transcriptBuilder';
import { ApiError } from '../apiError';
import { optionalString, requireId, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const applicationRepo = lazyRepo(Application);
const archivedAppConfigRepo = lazyRepo(ArchivedApplicationConfig);
const archivedAppRepo = lazyRepo(ArchivedApplication);

export function registerApplicationHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/applications/:id/approve
  routes.set('POST /applications/:id/approve', async (guildId, body, url) => {
    const appId = requireId(url, 'applications');
    const approvedBy = optionalString(body, 'triggeredBy') ?? requireString(body, 'approvedBy');

    const app = await applicationRepo.findOneBy({ guildId, id: appId });
    if (!app) throw ApiError.notFound('Application not found');
    if (app.status === 'closed') throw ApiError.conflict('Application already closed');

    await applicationRepo.update({ id: app.id, guildId }, { status: 'accepted' });

    // Send approval message in channel if accessible
    const channel = app.channelId ? await client.channels.fetch(app.channelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      const message = optionalString(body, 'message') ?? 'Your application has been approved.';
      await (channel as GuildTextBasedChannel).send(`✅ **Application Approved** by <@${approvedBy}>\n${message}`);
    }

    await writeAuditLog(guildId, 'application.approve', approvedBy, {
      applicationId: app.id,
    });
    return { success: true, applicationId: app.id };
  });

  // POST /internal/guilds/:guildId/applications/:id/deny
  routes.set('POST /applications/:id/deny', async (guildId, body, url) => {
    const appId = requireId(url, 'applications');
    const deniedBy = optionalString(body, 'triggeredBy') ?? requireString(body, 'deniedBy');

    const app = await applicationRepo.findOneBy({ guildId, id: appId });
    if (!app) throw ApiError.notFound('Application not found');
    if (app.status === 'closed') throw ApiError.conflict('Application already closed');

    await applicationRepo.update({ id: app.id, guildId }, { status: 'rejected' });

    const channel = app.channelId ? await client.channels.fetch(app.channelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      const reason = optionalString(body, 'reason') ?? 'No reason provided.';
      await (channel as GuildTextBasedChannel).send(`❌ **Application Denied** by <@${deniedBy}>\nReason: ${reason}`);
    }

    await writeAuditLog(guildId, 'application.deny', deniedBy, {
      applicationId: app.id,
    });
    return { success: true, applicationId: app.id };
  });

  // POST /internal/guilds/:guildId/applications/:id/archive
  routes.set('POST /applications/:id/archive', async (guildId, body, url) => {
    const appId = requireId(url, 'applications');
    const app = await applicationRepo.findOneBy({ guildId, id: appId });
    if (!app) throw ApiError.notFound('Application not found');

    const archivedConfig = await archivedAppConfigRepo.findOneBy({ guildId });
    if (!archivedConfig) throw ApiError.notFound('Archive config not found');

    // Mark closed
    await applicationRepo.update({ id: app.id, guildId }, { status: 'closed' });

    const channel = app.channelId ? await client.channels.fetch(app.channelId).catch(() => null) : null;
    if (!channel || !channel.isTextBased()) {
      return { success: true, archived: false };
    }

    // Build the transcript directly as Discord-markdown chunks — no files.
    let transcriptMessages: TranscriptMessage[];
    try {
      transcriptMessages = await fetchMessagesAsTranscript(channel as GuildTextBasedChannel, client.user?.id ?? '');
    } catch (error) {
      enhancedLogger.error('Failed to fetch application messages for transcript', error as Error, LogCategory.SYSTEM, {
        guildId,
        channelId: app.channelId,
      });
      return { success: true, archived: false };
    }

    const creatorUser = await client.users.fetch(app.createdBy).catch(() => null);
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

      const existingArchive = await archivedAppRepo.findOneBy({
        createdBy: app.createdBy,
        guildId,
      });

      if (!existingArchive) {
        const newPost = await forumChannel.threads.create({
          name: creatorUser?.username || 'Unknown',
          message: { content: transcript.header },
        });
        for (const chunk of transcript.chunks) {
          await newPost.send({ content: chunk });
        }
        await archivedAppRepo.save(
          archivedAppRepo.create({
            guildId,
            createdBy: app.createdBy,
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
        channelId: app.channelId,
      });
    }

    // Delete application channel (verified)
    const deleteResult = await verifiedChannelDelete(channel as GuildTextBasedChannel, {
      guildId,
      label: 'application channel (API)',
    });
    if (!deleteResult.success) {
      enhancedLogger.error('Application channel persisted after API archive', undefined, LogCategory.ERROR, {
        guildId,
        channelId: app.channelId,
      });
    }

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'application.archive', triggeredBy, {
      applicationId: app.id,
    });
    return { success: true };
  });
}
