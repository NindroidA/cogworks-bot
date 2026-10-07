/**
 * Ticket SLA Checker
 *
 * Periodically checks for tickets that have breached their SLA target
 * (no first response within the configured time). Posts alerts to the
 * configured breach channel and marks tickets as breached.
 */

import { type Client, EmbedBuilder, SnowflakeUtil, type TextChannel } from 'discord.js';
import { fmt, lang } from '../../lang';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { isValidSnowflake } from '../api/helpers';
import { SCHEDULER_GUARDS } from '../constants';
import { lazyRepo } from '../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

const ticketConfigRepo = lazyRepo(TicketConfig);
const ticketRepo = lazyRepo(Ticket);
const tl = lang.ticket.sla;

/**
 * Check all guilds with SLA enabled and process breach alerts.
 * Scheduled every INTERVALS.SLA_CHECK by startPeriodicJobs (utils/startup.ts).
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

      // Opened before firstResponseAt was recorded: NULL means "unknown", not "no reply".
      const openedAt = getTicketOpenedAt(ticket);
      if (openedAt < SCHEDULER_GUARDS.SLA_TRACKED_SINCE_MS) continue;

      // The clock runs from when the ticket opened. lastActivityAt can't be used:
      // every message (the opener's too) moves it, restarting the clock.
      const elapsed = now - openedAt;

      if (elapsed < targetMs) continue;
      // Already flagged on an earlier tick: only a delivered alert is new.
      const alreadyFlagged = ticket.slaBreached;
      if (alreadyFlagged && !breachChannel) continue;

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
            fmt(tl.breachAlert, {
              ticketId: ticket.id,
              channelId: ticket.channelId || 'unknown',
              elapsed: elapsedMinutes,
              target: targetMinutes,
            }),
          )
          .setColor(0xff0000);
        try {
          await breachChannel.send({ embeds: [embed] });
          notified = true;
        } catch (error) {
          // Retried every tick until it lands (e.g. once the bot gets Send
          // Messages there); only the first failure is worth an error.
          if (alreadyFlagged) {
            enhancedLogger.debug('SLA breach alert retry failed', LogCategory.SYSTEM, {
              guildId: config.guildId,
              ticketId: ticket.id,
            });
          } else {
            enhancedLogger.error(
              'Failed to send SLA breach alert',
              error instanceof Error ? error : new Error(String(error)),
              LogCategory.ERROR,
              { guildId: config.guildId, ticketId: ticket.id },
            );
          }
        }
      }
      if (alreadyFlagged && !notified) continue;

      // Targeted UPDATE, not save(): a full-entity save would write back the
      // firstResponseAt we loaded as NULL, clobbering a value captured
      // concurrently by messageCreate between this find and the write (v3.16.0
      // made firstResponseAt a live column). Touch only the two breach columns.
      await ticketRepo.update(
        { id: ticket.id, guildId: config.guildId },
        { slaBreached: true, slaBreachNotified: notified },
      );

      enhancedLogger.info(alreadyFlagged ? 'SLA breach alert delivered' : 'SLA breach detected', LogCategory.SYSTEM, {
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
 * When the ticket was opened. Its channel is created with it, so the channel
 * ID's snowflake timestamp is exact; lastActivityAt moves with every message
 * and statusHistory starts at the first status change. A ticket with no
 * channel falls back to the earlier of those two (both only move forward).
 */
export function getTicketOpenedAt(ticket: Ticket): number {
  if (ticket.channelId && isValidSnowflake(ticket.channelId)) {
    return SnowflakeUtil.timestampFrom(ticket.channelId);
  }
  const lastActivity = new Date(ticket.lastActivityAt).getTime();
  const firstChange = ticket.statusHistory?.[0]?.changedAt;
  return firstChange ? Math.min(new Date(firstChange).getTime(), lastActivity) : lastActivity;
}

/** Time from open to the first staff response, never negative; null when nobody has responded. */
export function getFirstResponseMs(ticket: Ticket): number | null {
  if (!ticket.firstResponseAt) return null;
  return Math.max(0, new Date(ticket.firstResponseAt).getTime() - getTicketOpenedAt(ticket));
}
