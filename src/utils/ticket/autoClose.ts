/**
 * Ticket Auto-Close System
 *
 * Periodically checks for inactive tickets in the configured auto-close status,
 * warns them, and once the warning has had its full window closes them through
 * the same claim → archive → revert path as the Close button.
 */

import { type Client, EmbedBuilder, type GuildTextBasedChannel } from 'discord.js';
import { lang } from '../../lang';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { MAX } from '../constants';
import { lazyRepo } from '../database/lazyRepo';
import { claimClose } from '../database/statusFlip';
import { formatLang } from '../index';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { appendStatusHistory } from '../workflow/workflowHelpers';
import { claimAndArchiveTicket } from './claimAndArchive';
import { archiveAndCloseTicket } from './closeWorkflow';

const ticketConfigRepo = lazyRepo(TicketConfig);
const ticketRepo = lazyRepo(Ticket);
const archivedTicketConfigRepo = lazyRepo(ArchivedTicketConfig);
const tl = lang.ticket.workflow;

const HOUR_MS = 60 * 60 * 1000;
const WARNING_NOTE = 'autoclose-warning';
/**
 * The job runs hourly and stamps the warning a few seconds into the run that
 * sent it. Without this slack, a warning sent on schedule would miss the
 * close by those seconds and every auto-close would land one run (an hour) late.
 */
const WARNING_SLACK_MS = 15 * 60 * 1000;

/**
 * Stored statuses that mean the workflow's 'open'. Panel tickets are written as
 * 'opened' and the column default is 'created', so an untouched ticket never
 * literally says 'open'.
 */
export const OPEN_STATUS_ALIASES = ['open', 'opened', 'created'];

/** Map a stored ticket status to its workflow status id. */
export function toWorkflowStatusId(status: string): string {
  return OPEN_STATUS_ALIASES.includes(status) ? 'open' : status;
}

/** Injectable seam (same pattern as events/ticket/close.ts); production omits it. */
export interface AutoCloseDeps {
  ticketConfigRepo: typeof ticketConfigRepo;
  ticketRepo: typeof ticketRepo;
  archivedTicketConfigRepo: typeof archivedTicketConfigRepo;
  archiveAndCloseTicket: typeof archiveAndCloseTicket;
}

const defaultDeps: AutoCloseDeps = { ticketConfigRepo, ticketRepo, archivedTicketConfigRepo, archiveAndCloseTicket };

/** Cut-offs for one run, as epoch ms. A ticket idle since before `warnBefore` gets warned; before `closeBefore`, closed. */
export interface AutoCloseWindow {
  now: number;
  warnBefore: number;
  closeBefore: number;
  warningMs: number;
}

export function autoCloseWindow(
  config: Pick<TicketConfig, 'autoCloseDays' | 'autoCloseWarningHours'>,
  now: number,
): AutoCloseWindow {
  const closeMs = config.autoCloseDays * 24 * HOUR_MS;
  const warningMs = config.autoCloseWarningHours * HOUR_MS;
  return { now, warnBefore: now - closeMs + warningMs, closeBefore: now - closeMs, warningMs };
}

/**
 * What to do with an idle ticket this run. A warning only counts while it is
 * newer than the ticket's last activity, so any new message or status change
 * clears it and the next idle period starts with a fresh warning. The close
 * also waits until the warning has been up for its full window, so a warning
 * sent late (bot offline during the window) still gets the hours it promised.
 */
export function decideAutoCloseAction(
  ticket: Pick<Ticket, 'lastActivityAt' | 'statusHistory'>,
  window: AutoCloseWindow,
): 'warn' | 'close' | 'wait' {
  const lastActivity = new Date(ticket.lastActivityAt).getTime();
  if (lastActivity >= window.warnBefore) return 'wait';

  const warnedAt = Math.max(
    0,
    ...(ticket.statusHistory ?? []).filter(e => e.note === WARNING_NOTE).map(e => Date.parse(e.changedAt) || 0),
  );
  if (warnedAt <= lastActivity) return 'warn';

  const warningServed = window.now - warnedAt >= window.warningMs - WARNING_SLACK_MS;
  return lastActivity < window.closeBefore && warningServed ? 'close' : 'wait';
}

/**
 * Check all guilds with auto-close enabled and process inactive tickets.
 * Called by a periodic interval (every hour).
 */
export async function checkAndAutoCloseTickets(client: Client, deps: AutoCloseDeps = defaultDeps): Promise<void> {
  try {
    const configs = await deps.ticketConfigRepo.find({
      where: {
        autoCloseEnabled: true,
        enableWorkflow: true,
      },
    });

    if (configs.length === 0) return;

    // Process guilds in parallel with bounded concurrency
    const results = await Promise.allSettled(configs.map(config => processGuildAutoClose(client, config, deps)));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        enhancedLogger.error(
          `Auto-close failed for guild ${configs[i].guildId}`,
          result.reason as Error,
          LogCategory.ERROR,
          { guildId: configs[i].guildId },
        );
      }
    }
  } catch (error) {
    enhancedLogger.error('Auto-close check failed', error as Error, LogCategory.ERROR);
  }
}

async function processGuildAutoClose(client: Client, config: TicketConfig, deps: AutoCloseDeps): Promise<void> {
  const guildId = config.guildId;

  // Closing means archiving, and that needs the archive forum. Without one
  // (never set up, or deleted, which blanks channelId), leave the tickets
  // alone rather than warn about a close that can't happen.
  const archivedConfig = await deps.archivedTicketConfigRepo.findOneBy({ guildId });
  if (!archivedConfig?.channelId) {
    enhancedLogger.warn('Auto-close skipped — no archive forum configured', LogCategory.SYSTEM, { guildId });
    return;
  }

  const window = autoCloseWindow(config, Date.now());
  const workflowStatus = config.autoCloseStatus || 'resolved';
  const statuses = workflowStatus === 'open' ? OPEN_STATUS_ALIASES : [workflowStatus];

  const inactiveTickets = await deps.ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId })
    .andWhere('ticket.status IN (:...statuses)', { statuses })
    .andWhere('ticket.lastActivityAt < :warnBefore', { warnBefore: new Date(window.warnBefore) })
    .getMany();

  for (const ticket of inactiveTickets) {
    try {
      await processTicket(client, config, ticket, statuses, archivedConfig.channelId, window, deps);
    } catch (error) {
      enhancedLogger.error(`Auto-close processing failed for ticket ${ticket.id}`, error as Error, LogCategory.ERROR, {
        guildId,
        ticketId: ticket.id,
      });
    }
  }
}

async function processTicket(
  client: Client,
  config: TicketConfig,
  loaded: Ticket,
  statuses: string[],
  archiveForumId: string,
  window: AutoCloseWindow,
  deps: AutoCloseDeps,
): Promise<void> {
  const guildId = config.guildId;
  if (decideAutoCloseAction(loaded, window) === 'wait') return;

  const channel = await fetchTicketChannel(client, loaded);
  if (channel === 'unavailable') return; // retry next run

  // The run loads every idle ticket up front and works through them one by
  // one, and each close fetches and posts a whole transcript, so by a ticket's
  // turn its loaded row can be minutes old. Re-read it right before acting, so
  // a reply to the warning or a staff status change made since the query
  // cancels the warning or close.
  const ticket = await deps.ticketRepo.findOneBy({ id: loaded.id, guildId });
  if (!ticket || !statuses.includes(ticket.status)) return;
  const action = decideAutoCloseAction(ticket, window);
  if (action === 'wait') return;

  if (channel === 'gone') {
    // Nothing left to warn or archive: close the row once the ticket is past
    // its inactivity deadline.
    if (new Date(ticket.lastActivityAt).getTime() < window.closeBefore) {
      await claimClose(deps.ticketRepo, ticket.id, guildId);
    }
    return;
  }

  if (action === 'warn') {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setDescription(formatLang(tl.autoCloseWarning, config.autoCloseWarningHours.toString()))
          .setColor(0xffa500),
      ],
    });
    // Targeted update: a full save(ticket) would overwrite a lastActivityAt
    // or firstResponseAt written since the ticket was loaded.
    appendStatusHistory(ticket, ticket.status, 'system', MAX.TICKET_STATUS_HISTORY, WARNING_NOTE);
    await deps.ticketRepo.update({ id: ticket.id, guildId }, { statusHistory: ticket.statusHistory });
    enhancedLogger.info('Auto-close warning sent', LogCategory.SYSTEM, { guildId, ticketId: ticket.id });
    return;
  }

  // The warning posted earlier stays in the transcript as the reason.
  const outcome = await claimAndArchiveTicket(
    client,
    ticket,
    guildId,
    channel,
    archiveForumId,
    client.user ? { id: client.user.id, username: client.user.username } : undefined,
    deps,
  );
  enhancedLogger.info(`Ticket auto-close: ${outcome}`, LogCategory.SYSTEM, {
    guildId,
    ticketId: ticket.id,
    inactiveDays: config.autoCloseDays,
  });
}

/**
 * The ticket's channel, or 'gone' when it no longer exists (no id, Discord
 * 10003 Unknown Channel). Any other fetch failure (permissions, outage) is
 * 'unavailable': treating it as gone would close the row and strand a live
 * channel.
 */
async function fetchTicketChannel(
  client: Client,
  ticket: Ticket,
): Promise<GuildTextBasedChannel | 'gone' | 'unavailable'> {
  if (!ticket.channelId) return 'gone';
  try {
    const channel = await client.channels.fetch(ticket.channelId);
    return channel?.isTextBased() ? (channel as GuildTextBasedChannel) : 'gone';
  } catch (error) {
    if ((error as { code?: number })?.code === 10003) return 'gone';
    enhancedLogger.warn('Auto-close could not fetch ticket channel — will retry', LogCategory.SYSTEM, {
      guildId: ticket.guildId,
      ticketId: ticket.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unavailable';
  }
}
