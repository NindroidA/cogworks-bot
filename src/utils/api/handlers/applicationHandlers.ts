import type { Client, GuildTextBasedChannel } from 'discord.js';
import { Application } from '../../../typeorm/entities/application/Application';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { archiveAndCloseApplication } from '../../application/closeWorkflow';
import { lazyRepo } from '../../database/lazyRepo';
import { ApiError } from '../apiError';
import { optionalString, requireId, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const applicationRepo = lazyRepo(Application);
const archivedAppConfigRepo = lazyRepo(ArchivedApplicationConfig);

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

    const result = await archiveAndCloseApplication(
      client,
      app,
      guildId,
      channel as GuildTextBasedChannel,
      archivedConfig.channelId,
    );

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'application.archive', triggeredBy, {
      applicationId: app.id,
    });
    return { success: result.success, archived: result.archived };
  });
}
