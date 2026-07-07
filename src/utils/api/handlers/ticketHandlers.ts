import type { Client, GuildTextBasedChannel } from 'discord.js';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { lazyRepo } from '../../database/lazyRepo';
import { claimClose, releaseClose } from '../../database/statusFlip';
import { archiveAndCloseTicket as defaultArchiveAndCloseTicket } from '../../ticket/closeWorkflow';
import { ApiError } from '../apiError';
import { getAndValidateEntity, isValidSnowflake, optionalString, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditAction } from './auditHelper';

const ticketRepo = lazyRepo(Ticket);
const archivedTicketConfigRepo = lazyRepo(ArchivedTicketConfig);

/**
 * @param archiveAndCloseTicket Injectable for tests — defaults to the real
 * close workflow. Passing a fake here lets the handler test avoid
 * `mock.module()` on the shared closeWorkflow module, which would otherwise
 * leak process-globally and poison closeWorkflow's own test suite (bun's
 * mock.module is process-shared and not undone by mock.restore).
 */
export function registerTicketHandlers(
  client: Client,
  routes: Map<string, RouteHandler>,
  archiveAndCloseTicket: typeof defaultArchiveAndCloseTicket = defaultArchiveAndCloseTicket,
): void {
  // POST /internal/guilds/:guildId/tickets/:id/close
  routes.set('POST /tickets/:id/close', async (guildId, body, url) => {
    const ticket = await getAndValidateEntity(url, 'tickets', ticketRepo, guildId, {
      notFoundMessage: 'Ticket not found',
    });
    if (ticket.status === 'closed') throw ApiError.conflict('Ticket already closed');

    const archivedConfig = await archivedTicketConfigRepo.findOneBy({
      guildId,
    });
    if (!archivedConfig) throw ApiError.notFound('Archive config not found');

    // Mark closed immediately — atomic flip so a concurrent close (button
    // click racing the dashboard) loses cleanly instead of both proceeding
    // past the guard above.
    if (!(await claimClose(ticketRepo, ticket.id, guildId))) {
      throw ApiError.conflict('Ticket already closed');
    }

    // Get channel. Distinguish a genuinely-gone channel (Discord 10003 →
    // nothing to archive, terminal close) from a transient/permission fetch
    // failure (→ revert so a retry can still archive, rather than stranding a
    // live ticket as 'closed').
    let channelFetchFailed = false;
    const channel = ticket.channelId
      ? await client.channels.fetch(ticket.channelId).catch((err: unknown) => {
          if ((err as { code?: number })?.code !== 10003) channelFetchFailed = true;
          return null;
        })
      : null;
    if (channelFetchFailed) {
      await releaseClose(ticketRepo, ticket.id, guildId, ticket.status);
      return { success: false, ticketId: ticket.id, archived: false };
    }
    if (!channel?.isTextBased()) {
      return { success: true, ticketId: ticket.id, archived: false };
    }

    // ninsys-api sends the dashboard actor's id as `triggeredBy` — the
    // workflow resolves the username for the "Closed by" archive row.
    const triggeredBy = optionalString(body, 'triggeredBy');

    let result: Awaited<ReturnType<typeof archiveAndCloseTicket>>;
    try {
      result = await archiveAndCloseTicket(
        client,
        ticket,
        guildId,
        channel as GuildTextBasedChannel,
        archivedConfig.channelId,
        undefined,
        triggeredBy ? { id: triggeredBy } : undefined,
      );
    } catch (error) {
      // An unexpected throw escaped the workflow (its metadata region isn't
      // inside its try blocks). The channel still exists — revert the status
      // so the close can be retried instead of stranding it 'closed', then
      // rethrow so the API reports the failure (mirrors events/ticket/close.ts).
      await releaseClose(ticketRepo, ticket.id, guildId, ticket.status);
      throw error;
    }

    if (!result.archived) {
      // Archive failed — the workflow preserved the channel; revert the status
      // so the close can be retried instead of stranding it 'closed'.
      await releaseClose(ticketRepo, ticket.id, guildId, ticket.status);
      return { success: false, ticketId: ticket.id, archived: false };
    }

    await writeAuditAction(guildId, body, 'ticket.close', {
      ticketId: ticket.id,
    });
    return { success: true, ticketId: ticket.id, archived: true };
  });

  // POST /internal/guilds/:guildId/tickets/:id/assign
  routes.set('POST /tickets/:id/assign', async (guildId, body, url) => {
    const userId = requireString(body, 'userId');
    if (!isValidSnowflake(userId)) throw ApiError.badRequest('Invalid userId format');

    const ticket = await getAndValidateEntity(url, 'tickets', ticketRepo, guildId, {
      notFoundMessage: 'Ticket not found',
    });

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw ApiError.notFound('Guild not found');
    if (!ticket.channelId) throw ApiError.conflict('Ticket has no channel');

    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) throw ApiError.notFound('Ticket channel not found');

    if ('permissionOverwrites' in channel) {
      await channel.permissionOverwrites.create(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    }

    // Persist the assignment. The permission overwrite alone left the DB
    // unaware of who owns the ticket — assignedTo/assignedAt were never
    // written, so the dashboard and close transcript showed it unassigned.
    await ticketRepo.update({ id: ticket.id, guildId }, { assignedTo: userId, assignedAt: new Date() });

    await writeAuditAction(guildId, body, 'ticket.assign', {
      ticketId: ticket.id,
      userId,
    });
    return { success: true };
  });
}
