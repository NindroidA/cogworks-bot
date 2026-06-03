import type { Client, GuildTextBasedChannel } from 'discord.js';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { lazyRepo } from '../../database/lazyRepo';
import { archiveAndCloseTicket as defaultArchiveAndCloseTicket } from '../../ticket/closeWorkflow';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalString, requireId, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

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
    const ticketId = requireId(url, 'tickets');
    const ticket = await ticketRepo.findOneBy({ guildId, id: ticketId });
    if (!ticket) throw ApiError.notFound('Ticket not found');
    if (ticket.status === 'closed') throw ApiError.conflict('Ticket already closed');

    const archivedConfig = await archivedTicketConfigRepo.findOneBy({
      guildId,
    });
    if (!archivedConfig) throw ApiError.notFound('Archive config not found');

    // Mark closed immediately
    await ticketRepo.update({ id: ticket.id, guildId }, { status: 'closed' });

    // Get channel
    const channel = ticket.channelId ? await client.channels.fetch(ticket.channelId).catch(() => null) : null;
    if (!channel || !channel.isTextBased()) {
      return { success: true, ticketId: ticket.id, archived: false };
    }

    const result = await archiveAndCloseTicket(
      client,
      ticket,
      guildId,
      channel as GuildTextBasedChannel,
      archivedConfig.channelId,
    );

    if (!result.archived) {
      // Archive failed — the workflow preserved the channel; revert the status
      // so the close can be retried instead of stranding it 'closed'.
      await ticketRepo.update({ id: ticket.id, guildId }, { status: ticket.status });
      return { success: false, ticketId: ticket.id, archived: false };
    }

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'ticket.close', triggeredBy, {
      ticketId: ticket.id,
    });
    return { success: true, ticketId: ticket.id, archived: true };
  });

  // POST /internal/guilds/:guildId/tickets/:id/assign
  routes.set('POST /tickets/:id/assign', async (guildId, body, url) => {
    const ticketId = requireId(url, 'tickets');
    const userId = requireString(body, 'userId');
    if (!isValidSnowflake(userId)) throw ApiError.badRequest('Invalid userId format');

    const ticket = await ticketRepo.findOneBy({ guildId, id: ticketId });
    if (!ticket) throw ApiError.notFound('Ticket not found');

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

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'ticket.assign', triggeredBy, {
      ticketId,
      userId,
    });
    return { success: true };
  });
}
