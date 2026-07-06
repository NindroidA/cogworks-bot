import type { Client, GuildTextBasedChannel } from 'discord.js';
import { Not } from 'typeorm';
import { Application } from '../../../typeorm/entities/application/Application';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { archiveAndCloseApplication as defaultArchiveAndCloseApplication } from '../../application/closeWorkflow';
import { lazyRepo } from '../../database/lazyRepo';
import { claimClose, releaseClose } from '../../database/statusFlip';
import { ApiError } from '../apiError';
import { getAndValidateEntity, optionalString, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditAction, writeAuditLog } from './auditHelper';

const applicationRepo = lazyRepo(Application);
const archivedAppConfigRepo = lazyRepo(ArchivedApplicationConfig);

/**
 * @param archiveAndCloseApplication Injectable for tests — defaults to the real
 * close workflow. Passing a fake here lets the handler test avoid
 * `mock.module()` on the shared closeWorkflow module, which would otherwise leak
 * process-globally and poison closeWorkflow's own test suite (bun's mock.module
 * is process-shared and not undone by mock.restore).
 */
export function registerApplicationHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
  archiveAndCloseApplication: typeof defaultArchiveAndCloseApplication = defaultArchiveAndCloseApplication,
): void {
  // POST /internal/guilds/:guildId/applications/:id/approve
  routes.set('POST /applications/:id/approve', async (guildId, body, url) => {
    const approvedBy = optionalString(body, 'triggeredBy') ?? requireString(body, 'approvedBy');

    const app = await getAndValidateEntity(url, 'applications', applicationRepo, guildId, {
      notFoundMessage: 'Application not found',
    });
    if (app.status === 'closed') throw ApiError.conflict('Application already closed');

    // Conditional — an approve racing a concurrent archive must not overwrite
    // 'closed' and resurrect an application that is mid-archive.
    const flip = await applicationRepo.update({ id: app.id, guildId, status: Not('closed') }, { status: 'accepted' });
    if (flip?.affected === 0) throw ApiError.conflict('Application already closed');

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
    const deniedBy = optionalString(body, 'triggeredBy') ?? requireString(body, 'deniedBy');

    const app = await getAndValidateEntity(url, 'applications', applicationRepo, guildId, {
      notFoundMessage: 'Application not found',
    });
    if (app.status === 'closed') throw ApiError.conflict('Application already closed');

    // Conditional — a deny racing a concurrent archive must not overwrite
    // 'closed' (see approve above).
    const flip = await applicationRepo.update({ id: app.id, guildId, status: Not('closed') }, { status: 'rejected' });
    if (flip?.affected === 0) throw ApiError.conflict('Application already closed');

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
    const app = await getAndValidateEntity(url, 'applications', applicationRepo, guildId, {
      notFoundMessage: 'Application not found',
    });

    const archivedConfig = await archivedAppConfigRepo.findOneBy({ guildId });
    if (!archivedConfig) throw ApiError.notFound('Archive config not found');

    // Mark closed — atomic flip so a concurrent close (or the Discord close
    // button) loses cleanly instead of both proceeding.
    if (!(await claimClose(applicationRepo, app.id, guildId))) {
      throw ApiError.conflict('Application already closed');
    }

    // Distinguish a genuinely-gone channel (10003 → nothing to archive, terminal
    // close) from a transient/permission fetch failure (→ revert so a retry can
    // still archive, rather than stranding a live application as 'closed').
    let channelFetchFailed = false;
    const channel = app.channelId
      ? await client.channels.fetch(app.channelId).catch((err: unknown) => {
          if ((err as { code?: number })?.code !== 10003) channelFetchFailed = true;
          return null;
        })
      : null;
    if (channelFetchFailed) {
      await releaseClose(applicationRepo, app.id, guildId, app.status);
      return { success: false, archived: false };
    }
    if (!channel?.isTextBased()) {
      return { success: true, archived: false };
    }

    // ninsys-api sends the dashboard actor's id as `triggeredBy` — the
    // workflow resolves the username for the "Closed by" archive row.
    const triggeredBy = optionalString(body, 'triggeredBy');

    let result: Awaited<ReturnType<typeof archiveAndCloseApplication>>;
    try {
      result = await archiveAndCloseApplication(
        client,
        app,
        guildId,
        channel as GuildTextBasedChannel,
        archivedConfig.channelId,
        undefined,
        triggeredBy ? { id: triggeredBy } : undefined,
      );
    } catch (error) {
      // Unexpected throw — the channel still exists; revert so the archive can
      // be retried, then rethrow so the API reports the failure (mirrors the
      // ticket close handler + events/application/close.ts).
      await releaseClose(applicationRepo, app.id, guildId, app.status);
      throw error;
    }

    if (!result.archived) {
      // Archive failed — the workflow preserved the channel; revert the status
      // so the archive can be retried instead of stranding it 'closed'.
      await releaseClose(applicationRepo, app.id, guildId, app.status);
      return { success: false, archived: false };
    }

    await writeAuditAction(guildId, body, 'application.archive', {
      applicationId: app.id,
    });
    return { success: true, archived: true };
  });
}
