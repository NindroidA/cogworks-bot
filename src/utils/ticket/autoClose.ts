/**
 * Ticket Auto-Close System
 *
 * Periodically checks for inactive tickets in the configured auto-close status
 * and sends warnings or closes them after the configured inactivity period.
 */

import { type Client, EmbedBuilder, type TextChannel } from 'discord.js';
import { lang } from '../../lang';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { lazyRepo } from '../database/lazyRepo';
import { LANGF } from '../index';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

const ticketConfigRepo = lazyRepo(TicketConfig);
const ticketRepo = lazyRepo(Ticket);
const tl = lang.ticket.workflow;

/**
 * Check all guilds with auto-close enabled and process inactive tickets.
 * Called by a periodic interval (every hour).
 */
export async function checkAndAutoCloseTickets(client: Client): Promise<void> {
  try {
    const configs = await ticketConfigRepo.find({
      where: {
        autoCloseEnabled: true,
        enableWorkflow: true,
      },
    });

    if (configs.length === 0) return;

    // Process guilds sequentially to avoid overwhelming the DB
    for (const config of configs) {
      try {
        await processGuildAutoClose(client, config);
      } catch (error) {
        enhancedLogger.error(
          `Auto-close failed for guild ${config.guildId}`,
          error as Error,
          LogCategory.ERROR,
          { guildId: config.guildId },
        );
      }
    }
  } catch (error) {
    enhancedLogger.error('Auto-close check failed', error as Error, LogCategory.ERROR);
  }
}

async function processGuildAutoClose(client: Client, config: TicketConfig): Promise<void> {
  const now = Date.now();
  const closeDaysMs = config.autoCloseDays * 24 * 60 * 60 * 1000;
  const warningMs = config.autoCloseWarningHours * 60 * 60 * 1000;
  const closeDeadline = new Date(now - closeDaysMs);
  const warningDeadline = new Date(now - closeDaysMs + warningMs);

  // Map 'created' to the autoCloseStatus if they match 'open'
  const statusToCheck = config.autoCloseStatus || 'resolved';

  // Find tickets in the auto-close status that have been inactive
  const inactiveTickets = await ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId: config.guildId })
    .andWhere('ticket.status = :status', { status: statusToCheck })
    .andWhere('ticket.lastActivityAt < :warningDeadline', { warningDeadline })
    .getMany();

  for (const ticket of inactiveTickets) {
    try {
      const lastActivity = new Date(ticket.lastActivityAt).getTime();

      if (lastActivity < closeDeadline.getTime()) {
        // Past deadline — auto-close
        await autoCloseTicket(client, config, ticket);
      } else if (lastActivity < warningDeadline.getTime()) {
        // Within warning window — send warning if not already sent
        await sendAutoCloseWarning(client, config, ticket);
      }
    } catch (error) {
      enhancedLogger.error(
        `Auto-close processing failed for ticket ${ticket.id}`,
        error as Error,
        LogCategory.ERROR,
        { guildId: config.guildId, ticketId: ticket.id },
      );
    }
  }
}

async function sendAutoCloseWarning(
  client: Client,
  config: TicketConfig,
  ticket: Ticket,
): Promise<void> {
  // Check if warning was already sent (look for autoclose-warning in history)
  const history = ticket.statusHistory || [];
  const hasWarning = history.some(entry => entry.note === 'autoclose-warning');

  if (hasWarning) return;

  // Try to send warning message in the ticket channel
  try {
    const channel = ticket.channelId
      ? ((await client.channels.fetch(ticket.channelId).catch(() => null)) as TextChannel | null)
      : null;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setDescription(LANGF(tl.autoCloseWarning, config.autoCloseWarningHours.toString()))
      .setColor(0xffa500)
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    // Mark warning as sent in status history
    const historyEntry = {
      status: ticket.status,
      changedBy: 'system',
      changedAt: new Date().toISOString(),
      note: 'autoclose-warning',
    };
    history.push(historyEntry);
    ticket.statusHistory = history;
    await ticketRepo.save(ticket);

    enhancedLogger.info('Auto-close warning sent', LogCategory.SYSTEM, {
      guildId: config.guildId,
      ticketId: ticket.id,
      channelId: ticket.channelId,
    });
  } catch (error) {
    enhancedLogger.error('Failed to send auto-close warning', error as Error, LogCategory.ERROR, {
      guildId: config.guildId,
      ticketId: ticket.id,
    });
  }
}

async function autoCloseTicket(
  client: Client,
  config: TicketConfig,
  ticket: Ticket,
): Promise<void> {
  try {
    const channel = ticket.channelId
      ? ((await client.channels.fetch(ticket.channelId).catch(() => null)) as TextChannel | null)
      : null;
    if (!channel) {
      // Channel doesn't exist — just mark as closed in DB
      ticket.status = 'closed' as Ticket['status'];
      await ticketRepo.save(ticket);
      return;
    }

    // Post auto-close message
    const embed = new EmbedBuilder()
      .setDescription(LANGF(tl.autoClosed, config.autoCloseDays.toString()))
      .setColor(0x808080)
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    // Update ticket status to closed
    const history = ticket.statusHistory || [];
    history.push({
      status: 'closed',
      changedBy: 'system',
      changedAt: new Date().toISOString(),
      note: 'auto-closed due to inactivity',
    });
    ticket.statusHistory = history;
    ticket.status = 'closed' as Ticket['status'];
    ticket.lastActivityAt = new Date();
    await ticketRepo.save(ticket);

    enhancedLogger.info('Ticket auto-closed', LogCategory.SYSTEM, {
      guildId: config.guildId,
      ticketId: ticket.id,
      channelId: ticket.channelId,
      inactiveDays: config.autoCloseDays,
    });

    // Note: We don't trigger the full archive flow here because that requires
    // a button interaction context. The ticket is marked closed in the DB and
    // can be archived via the close button or manually.
  } catch (error) {
    enhancedLogger.error('Failed to auto-close ticket', error as Error, LogCategory.ERROR, {
      guildId: config.guildId,
      ticketId: ticket.id,
    });
  }
}
