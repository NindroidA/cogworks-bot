/**
 * Ticket SLA Checker
 *
 * Periodically checks for tickets that have breached their SLA target
 * (no first response within the configured time). Posts alerts to the
 * configured breach channel and marks tickets as breached.
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
const tl = lang.ticket.sla;

/**
 * Check all guilds with SLA enabled and process breach alerts.
 * Called by a periodic interval (every hour).
 */
export async function checkAndAlertSlaBreaches(client: Client): Promise<void> {
  try {
    const configs = await ticketConfigRepo.find({
      where: {
        slaEnabled: true,
        enableWorkflow: true,
      },
    });

    if (configs.length === 0) return;

    for (const config of configs) {
      try {
        await processGuildSla(client, config);
      } catch (error) {
        enhancedLogger.error(
          `SLA check failed for guild ${config.guildId}`,
          error as Error,
          LogCategory.ERROR,
          { guildId: config.guildId },
        );
      }
    }
  } catch (error) {
    enhancedLogger.error('SLA check failed', error as Error, LogCategory.ERROR);
  }
}

async function processGuildSla(client: Client, config: TicketConfig): Promise<void> {
  const now = Date.now();

  // Find open tickets with no first response that haven't been notified yet
  const openTickets = await ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId: config.guildId })
    .andWhere('ticket.status != :closed', { closed: 'closed' })
    .andWhere('ticket.firstResponseAt IS NULL')
    .andWhere('ticket.slaBreachNotified = :notified', { notified: false })
    .getMany();

  if (openTickets.length === 0) return;

  // Get breach channel if configured
  let breachChannel: TextChannel | null = null;
  if (config.slaBreachChannelId) {
    breachChannel = (await client.channels
      .fetch(config.slaBreachChannelId)
      .catch(() => null)) as TextChannel | null;
  }

  for (const ticket of openTickets) {
    try {
      // Determine the SLA target for this ticket
      const targetMinutes = getSlaTargetForTicket(config, ticket);
      const targetMs = targetMinutes * 60 * 1000;

      // Use the ticket's creation time approximated by first status history entry or lastActivityAt
      const createdTime = getTicketCreationTime(ticket);
      const elapsed = now - createdTime;

      if (elapsed < targetMs) continue;

      // SLA breached
      const elapsedMinutes = Math.floor(elapsed / 60_000);

      ticket.slaBreached = true;
      ticket.slaBreachNotified = true;
      await ticketRepo.save(ticket);

      // Send breach alert
      if (breachChannel) {
        const embed = new EmbedBuilder()
          .setTitle(tl.breachAlertTitle)
          .setDescription(
            LANGF(
              tl.breachAlert,
              ticket.id.toString(),
              ticket.channelId || 'unknown',
              elapsedMinutes.toString(),
              targetMinutes.toString(),
            ),
          )
          .setColor(0xff0000)
          .setTimestamp();

        await breachChannel.send({ embeds: [embed] }).catch(() => {
          enhancedLogger.error(
            'Failed to send SLA breach alert',
            new Error('Channel send failed'),
            LogCategory.ERROR,
            { guildId: config.guildId, ticketId: ticket.id },
          );
        });
      }

      enhancedLogger.info('SLA breach detected', LogCategory.SYSTEM, {
        guildId: config.guildId,
        ticketId: ticket.id,
        elapsedMinutes,
        targetMinutes,
      });
    } catch (error) {
      enhancedLogger.error(
        `SLA processing failed for ticket ${ticket.id}`,
        error as Error,
        LogCategory.ERROR,
        { guildId: config.guildId, ticketId: ticket.id },
      );
    }
  }
}

/**
 * Get the SLA target for a specific ticket, considering per-type overrides.
 */
function getSlaTargetForTicket(config: TicketConfig, ticket: Ticket): number {
  if (config.slaPerType && ticket.customTypeId) {
    const perTypeTarget = config.slaPerType[ticket.customTypeId];
    if (perTypeTarget !== undefined) return perTypeTarget;
  }
  if (config.slaPerType && ticket.type) {
    const perTypeTarget = config.slaPerType[ticket.type];
    if (perTypeTarget !== undefined) return perTypeTarget;
  }
  return config.slaTargetMinutes;
}

/**
 * Approximate ticket creation time from status history or lastActivityAt.
 */
function getTicketCreationTime(ticket: Ticket): number {
  // Check status history for earliest entry
  if (ticket.statusHistory && ticket.statusHistory.length > 0) {
    const earliest = ticket.statusHistory[0];
    if (earliest.changedAt) {
      return new Date(earliest.changedAt).getTime();
    }
  }
  // Fallback to lastActivityAt (which is set on creation)
  return new Date(ticket.lastActivityAt).getTime();
}
