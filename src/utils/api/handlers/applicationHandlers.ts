import fs from 'node:fs';
import type { Client, ForumChannel, ForumThreadChannel, GuildTextBasedChannel } from 'discord.js';
import { Application } from '../../../typeorm/entities/application/Application';
import { ArchivedApplication } from '../../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { lazyRepo } from '../../database/lazyRepo';
import { fetchMessagesAndSaveToFile } from '../../fetchAllMessages';
import { ApiError } from '../apiError';
import { extractId } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const applicationRepo = lazyRepo(Application);
const archivedAppConfigRepo = lazyRepo(ArchivedApplicationConfig);
const archivedAppRepo = lazyRepo(ArchivedApplication);

export function registerApplicationHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
): void {
  // POST /internal/guilds/:guildId/applications/:id/approve
  routes.set('POST /applications/:id/approve', async (guildId, body, url) => {
    const appId = extractId(url, 'applications');
    const approvedBy = body.approvedBy as string;
    if (!approvedBy) throw ApiError.badRequest('approvedBy is required');

    const app = await applicationRepo.findOneBy({ guildId, id: appId });
    if (!app) throw ApiError.notFound('Application not found');
    if (app.status === 'closed') throw ApiError.conflict('Application already closed');

    await applicationRepo.update({ id: app.id, guildId }, { status: 'accepted' });

    // Send approval message in channel if accessible
    const channel = app.channelId
      ? await client.channels.fetch(app.channelId).catch(() => null)
      : null;
    if (channel?.isTextBased()) {
      const message = (body.message as string) || 'Your application has been approved.';
      await (channel as GuildTextBasedChannel).send(
        `✅ **Application Approved** by <@${approvedBy}>\n${message}`,
      );
    }

    await writeAuditLog(guildId, 'application.approve', approvedBy, {
      applicationId: app.id,
    });
    return { success: true, applicationId: app.id };
  });

  // POST /internal/guilds/:guildId/applications/:id/deny
  routes.set('POST /applications/:id/deny', async (guildId, body, url) => {
    const appId = extractId(url, 'applications');
    const deniedBy = body.deniedBy as string;
    if (!deniedBy) throw ApiError.badRequest('deniedBy is required');

    const app = await applicationRepo.findOneBy({ guildId, id: appId });
    if (!app) throw ApiError.notFound('Application not found');
    if (app.status === 'closed') throw ApiError.conflict('Application already closed');

    await applicationRepo.update({ id: app.id, guildId }, { status: 'rejected' });

    const channel = app.channelId
      ? await client.channels.fetch(app.channelId).catch(() => null)
      : null;
    if (channel?.isTextBased()) {
      const reason = (body.reason as string) || 'No reason provided.';
      await (channel as GuildTextBasedChannel).send(
        `❌ **Application Denied** by <@${deniedBy}>\nReason: ${reason}`,
      );
    }

    await writeAuditLog(guildId, 'application.deny', deniedBy, {
      applicationId: app.id,
    });
    return { success: true, applicationId: app.id };
  });

  // POST /internal/guilds/:guildId/applications/:id/archive
  routes.set('POST /applications/:id/archive', async (guildId, body, url) => {
    const appId = extractId(url, 'applications');
    const app = await applicationRepo.findOneBy({ guildId, id: appId });
    if (!app) throw ApiError.notFound('Application not found');

    const archivedConfig = await archivedAppConfigRepo.findOneBy({ guildId });
    if (!archivedConfig) throw ApiError.notFound('Archive config not found');

    // Mark closed
    await applicationRepo.update({ id: app.id, guildId }, { status: 'closed' });

    const channel = app.channelId
      ? await client.channels.fetch(app.channelId).catch(() => null)
      : null;
    if (!channel || !channel.isTextBased()) {
      return { success: true, archived: false };
    }

    const transcriptPath = process.env.TEMP_STORAGE_PATH || 'temp/';
    await fs.promises.mkdir(transcriptPath, { recursive: true });

    try {
      await fetchMessagesAndSaveToFile(channel as GuildTextBasedChannel, transcriptPath);
    } catch {
      return { success: true, archived: false };
    }

    try {
      const forumChannel = (await client.channels.fetch(archivedConfig.channelId)) as ForumChannel;
      const txtPath = `${transcriptPath}${app.channelId}.txt`;
      const zipPath = `${transcriptPath}attachments_${app.channelId}.zip`;
      const files = [txtPath];
      if (fs.existsSync(zipPath)) files.push(zipPath);

      const existingArchive = await archivedAppRepo.findOneBy({
        createdBy: app.createdBy,
        guildId,
      });

      if (!existingArchive) {
        const user = await client.users.fetch(app.createdBy).catch(() => null);
        const newPost = await forumChannel.threads.create({
          name: user?.username || 'Unknown',
          message: { files },
        });
        await archivedAppRepo.save(
          archivedAppRepo.create({
            guildId,
            createdBy: app.createdBy,
            messageId: newPost.id,
          }),
        );
      } else if (existingArchive.messageId) {
        const post = (await forumChannel.threads.fetch(
          existingArchive.messageId,
        )) as ForumThreadChannel;
        await post.send({ files });
      }

      await fs.promises.unlink(txtPath).catch(() => null);
      if (files.includes(zipPath)) {
        await fs.promises.unlink(zipPath).catch(() => null);
      }
    } catch {
      // Archive failed
    }

    // Delete application channel
    try {
      await (channel as GuildTextBasedChannel).delete();
    } catch {
      // Channel may be gone
    }

    await writeAuditLog(guildId, 'application.archive', body.triggeredBy as string, {
      applicationId: app.id,
    });
    return { success: true };
  });
}
