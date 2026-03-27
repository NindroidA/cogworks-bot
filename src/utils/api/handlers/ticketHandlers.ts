import type { Client, GuildTextBasedChannel } from 'discord.js';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { lazyRepo } from '../../database/lazyRepo';
import { archiveAndCloseTicket } from '../../ticket/closeWorkflow';
import { ApiError } from '../apiError';
import { isValidSnowflake, optionalString, requireId, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditLog } from './auditHelper';

const ticketRepo = lazyRepo(Ticket);
const archivedTicketConfigRepo = lazyRepo(ArchivedTicketConfig);

export function registerTicketHandlers(client: Client, routes: Map<string, RouteHandler>): void {
  // POST /internal/guilds/:guildId/tickets/:id/close
  routes.set('POST /tickets/:id/close', async (guildId, body, url) => {
    const ticketId = requireId(url, 'tickets');
    const ticket = await ticketRepo.findOneBy({ guildId, id: ticketId });
    if (!ticket) throw ApiError.notFound('Ticket not found');
    if (ticket.status === 'closed') throw ApiError.conflict('Ticket already closed');

    const archivedConfig = await archivedTicketConfigRepo.findOneBy({ guildId });
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

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'ticket.close', triggeredBy, { ticketId: ticket.id });
    return { success: true, ticketId: ticket.id, archived: result.archived };
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

    const triggeredBy = optionalString(body, 'triggeredBy');
    await writeAuditLog(guildId, 'ticket.assign', triggeredBy, { ticketId, userId });
    return { success: true };
  });
}
