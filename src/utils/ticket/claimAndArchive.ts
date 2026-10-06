/**
 * Claim → archive → revert-on-failure: the close sequence shared by the Close
 * button (events/ticket/close.ts) and `/ticket manage status closed`. (The
 * internal API handler runs the same steps inline.)
 *
 * The status flip happens first and atomically (claimClose), so a concurrent
 * close loses cleanly. If the archive throws or reports archived:false, the
 * workflow has preserved the channel, so the status is reverted. Otherwise the
 * duplicate-close guard would strand the ticket 'closed' with a live channel
 * and no way to retry.
 */

import type { Client, GuildTextBasedChannel } from 'discord.js';
import { lang } from '../../lang';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { lazyRepo } from '../database/lazyRepo';
import { claimClose, releaseClose } from '../database/statusFlip';
import { type EphemeralErrorTarget, replyEphemeralError } from '../interactions/replyHelper';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { archiveAndCloseTicket, type CloseActor } from './closeWorkflow';

const tl = lang.ticket.close;

/**
 * - `already-closed`: a concurrent close won the flip; nothing was touched.
 * - `failed`: the archive failed; status reverted, channel preserved for retry.
 * - `archived`: transcript saved and channel deleted.
 * - `channel-remains`: transcript saved, but Discord refused the channel delete.
 */
export type TicketCloseOutcome = 'already-closed' | 'failed' | 'archived' | 'channel-remains';

export interface ClaimAndArchiveDeps {
  ticketRepo: Parameters<typeof claimClose>[0];
  archiveAndCloseTicket: typeof archiveAndCloseTicket;
}

const defaultDeps: ClaimAndArchiveDeps = { ticketRepo: lazyRepo(Ticket), archiveAndCloseTicket };

export async function claimAndArchiveTicket(
  client: Client,
  ticket: Ticket,
  guildId: string,
  channel: GuildTextBasedChannel,
  archiveForumId: string,
  closedBy: CloseActor | undefined,
  deps: ClaimAndArchiveDeps = defaultDeps,
): Promise<TicketCloseOutcome> {
  const context = { guildId, channelId: ticket.channelId, ticketId: ticket.id };

  if (!(await claimClose(deps.ticketRepo, ticket.id, guildId))) {
    enhancedLogger.warn(
      'Ticket close lost the flip race — concurrent close already in progress',
      LogCategory.SYSTEM,
      context,
    );
    return 'already-closed';
  }

  try {
    const result = await deps.archiveAndCloseTicket(
      client,
      ticket,
      guildId,
      channel,
      archiveForumId,
      undefined,
      closedBy,
    );
    if (result.archived) {
      if (result.channelDeleted !== false) return 'archived';
      enhancedLogger.warn('Ticket archived but channel delete failed', LogCategory.SYSTEM, context);
      return 'channel-remains';
    }
    enhancedLogger.warn(
      'Ticket close reverted — archive failed, channel + ticket preserved for retry',
      LogCategory.SYSTEM,
      {
        ...context,
        transcriptFailed: result.transcriptFailed ?? false,
      },
    );
  } catch (error) {
    // e.g. a transient DB error while resolving a custom ticket type —
    // closeWorkflow's metadata region isn't inside its try blocks.
    enhancedLogger.error(
      'Ticket close threw unexpectedly — status reverted, channel preserved for retry',
      error instanceof Error ? error : undefined,
      LogCategory.ERROR,
      context,
    );
  }

  await releaseClose(deps.ticketRepo, ticket.id, guildId, ticket.status);
  return 'failed';
}

/**
 * Tell the person who closed the ticket how it went. A clean archive needs no
 * message: the channel, and the "Closing ticket..." ack with it, is gone.
 */
export async function reportTicketCloseOutcome(
  interaction: EphemeralErrorTarget,
  outcome: TicketCloseOutcome,
  reply: typeof replyEphemeralError = replyEphemeralError,
): Promise<void> {
  if (outcome === 'already-closed') await reply(interaction, tl.alreadyClosed);
  else if (outcome === 'failed') await reply(interaction, tl.transcriptCreate.error);
  else if (outcome === 'channel-remains') await reply(interaction, tl.archivedChannelRemains, { bugReport: true });
}
