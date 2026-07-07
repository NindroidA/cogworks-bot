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
import { formatLang } from '../index';
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
        enhancedLogger.error(`SLA check failed for guild ${config.guildId}`, error as Error, LogCategory.ERROR, {
          guildId: config.guildId,
        });
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
    breachChannel = (await client.channels.fetch(config.slaBreachChannelId).catch(() => null)) as TextChannel | null;
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

      // Only mark the breach as notified once an alert is actually delivered.
      // Otherwise an unconfigured/unreachable breach channel would permanently
      // flag the ticket notified with nothing sent — and the query filters on
      // slaBreachNotified = false, so it would never retry (even after an admin
      // later configures a valid channel). Leaving it false makes it retry.
      let notified = false;
      if (breachChannel) {
        const embed = new EmbedBuilder()
          .setTitle(tl.breachAlertTitle)
          .setDescription(
            formatLang(
              tl.breachAlert,
              ticket.id.toString(),
              ticket.channelId || 'unknown',
              elapsedMinutes.toString(),
              targetMinutes.toString(),
            ),
          )
          .setColor(0xff0000);
        try {
          await breachChannel.send({ embeds: [embed] });
          notified = true;
        } catch (error) {
          enhancedLogger.error(
            'Failed to send SLA breach alert',
            error instanceof Error ? error : new Error(String(error)),
            LogCategory.ERROR,
            { guildId: config.guildId, ticketId: ticket.id },
          );
        }
      }

      // Targeted UPDATE, not save(): a full-entity save would write back the
      // firstResponseAt we loaded as NULL, clobbering a value captured
      // concurrently by messageCreate between this find and the write (v3.16.0
      // made firstResponseAt a live column). Touch only the two breach columns.
      await ticketRepo.update(
        { id: ticket.id, guildId: config.guildId },
        { slaBreached: true, slaBreachNotified: notified },
      );

      enhancedLogger.info('SLA breach detected', LogCategory.SYSTEM, {
        guildId: config.guildId,
        ticketId: ticket.id,
        elapsedMinutes,
        targetMinutes,
      });
    } catch (error) {
      enhancedLogger.error(`SLA processing failed for ticket ${ticket.id}`, error as Error, LogCategory.ERROR, {
        guildId: config.guildId,
        ticketId: ticket.id,
      });
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
export function getTicketCreationTime(ticket: Ticket): number {
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
