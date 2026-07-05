import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  type GuildTextBasedChannel,
  MessageFlags,
} from 'discord.js';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { claimClose, enhancedLogger, LogCategory, lang, releaseClose, replyEphemeralError } from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';
import { type ArchiveTicketResult, archiveAndCloseTicket } from '../../utils/ticket/closeWorkflow';

const tl = lang.ticket.close;
const ticketRepo = lazyRepo(Ticket);
const archivedTicketConfigRepo = lazyRepo(ArchivedTicketConfig);

/**
 * Injectable seam for {@link ticketCloseEvent}. Production callers omit it (the
 * defaults bind the real repos + workflow). Tests pass fakes directly rather
 * than relying on `mock.module()`, which bun applies inconsistently across a
 * full-suite run — the same deterministic-injection pattern used by
 * `archiveAndCloseTicket` in closeWorkflow.ts.
 */
export interface TicketCloseDeps {
  ticketRepo: typeof ticketRepo;
  archivedTicketConfigRepo: typeof archivedTicketConfigRepo;
  archiveAndCloseTicket: typeof archiveAndCloseTicket;
  replyEphemeralError: typeof replyEphemeralError;
}

const defaultTicketCloseDeps: TicketCloseDeps = {
  ticketRepo,
  archivedTicketConfigRepo,
  archiveAndCloseTicket,
  replyEphemeralError,
};

export const ticketCloseEvent = async (
  client: Client,
  interaction: ButtonInteraction,
  deps: TicketCloseDeps = defaultTicketCloseDeps,
) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const channel = interaction.channel as GuildTextBasedChannel;
  const channelId = interaction.channelId || '';
  const archivedConfig = await deps.archivedTicketConfigRepo.findOneBy({ guildId });
  const ticket = await deps.ticketRepo.findOneBy({ guildId, channelId });

  // Every early return below runs AFTER confirmClose already showed the user
  // "Closing ticket..." (interaction.update). A bare return would freeze that
  // message forever — the reported "close button hangs, ticket never closes".
  // So each guard surfaces an ephemeral followUp before bailing.
  if (!archivedConfig) {
    enhancedLogger.warn(lang.ticket.archiveTicketConfigNotFound, LogCategory.SYSTEM, { guildId });
    await deps.replyEphemeralError(interaction, tl.notConfigured);
    return;
  }

  if (!ticket) {
    enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.SYSTEM, { guildId, channelId });
    await deps.replyEphemeralError(interaction, tl.notFound);
    return;
  }

  // Prevent duplicate close (double-click race condition)
  if (ticket.status === 'closed') {
    enhancedLogger.warn('Ticket already closed, skipping duplicate archive', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    await deps.replyEphemeralError(interaction, tl.alreadyClosed);
    return;
  }

  // Immediately mark as closed to prevent concurrent close attempts. The
  // status guard above is check-then-set — two near-simultaneous confirms
  // could both pass it — so the flip itself is atomic (claimClose): whoever
  // loses the UPDATE bails as a duplicate.
  if (!(await claimClose(deps.ticketRepo, ticket.id, guildId))) {
    enhancedLogger.warn('Ticket close lost the flip race — concurrent close already in progress', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    await deps.replyEphemeralError(interaction, tl.alreadyClosed);
    return;
  }

  let result: ArchiveTicketResult;
  try {
    result = await deps.archiveAndCloseTicket(client, ticket, guildId, channel, archivedConfig.channelId);
  } catch (error) {
    // An unexpected throw escaped the workflow (e.g. a transient DB error while
    // resolving a custom ticket type — closeWorkflow's metadata region isn't
    // inside its try blocks). The ticket was flipped to 'closed' above but the
    // channel still exists, so revert the status (otherwise the dup-close guard
    // strands it permanently) and tell the user instead of leaving them on
    // "Closing ticket...".
    await releaseClose(deps.ticketRepo, ticket.id, guildId, ticket.status);
    enhancedLogger.error(
      'Ticket close threw unexpectedly — status reverted, channel preserved for retry',
      error instanceof Error ? error : undefined,
      LogCategory.ERROR,
      { guildId, channelId, ticketId: ticket.id },
    );
    await deps.replyEphemeralError(interaction, tl.transcriptCreate.error).catch(() => {});
    return;
  }

  if (!result.archived) {
    // Close did not complete (transcript fetch or forum post failed). The
    // workflow deliberately preserved the channel, so revert the status —
    // otherwise the ticket is stranded 'closed' with a live channel and the
    // dup-close guard blocks any retry.
    await releaseClose(deps.ticketRepo, ticket.id, guildId, ticket.status);
    enhancedLogger.warn(
      'Ticket close reverted — archive failed, channel + ticket preserved for retry',
      LogCategory.SYSTEM,
      {
        guildId,
        channelId,
        ticketId: ticket.id,
        transcriptFailed: result.transcriptFailed ?? false,
      },
    );
    // replyEphemeralError picks reply/editReply/followUp from the interaction
    // state internally, so no branch on replied/deferred is needed.
    await deps.replyEphemeralError(interaction, tl.transcriptCreate.error).catch((err: unknown) => {
      enhancedLogger.error(
        'Failed to deliver ticket-close failure notice to the user',
        err instanceof Error ? err : undefined,
        LogCategory.SYSTEM,
        { guildId, channelId, ticketId: ticket.id },
      );
    });
  } else if (result.channelDeleted === false) {
    // Transcript archived OK, but Discord refused to delete the channel (e.g.
    // missing Manage Channels). The channel — and the "Closing ticket..." ack —
    // are still here, so tell the user instead of looking like a hang.
    enhancedLogger.warn('Ticket archived but channel delete failed — notifying user', LogCategory.SYSTEM, {
      guildId,
      channelId,
      ticketId: ticket.id,
    });
    await deps.replyEphemeralError(interaction, tl.archivedChannelRemains, { bugReport: true }).catch(() => {});
  }
};

// Auth model for the in-channel close/confirm/cancel buttons:
// these live inside the ticket channel, whose member list is set at creation
// (applicant + staff role + Discord admins). Anyone without channel-view
// cannot click them. Closing one's own ticket is intentional UX, so we
// deliberately do NOT layer guardFeatureAccess on top — the channel ACL is
// the gate. If a future change exposes these buttons outside their ticket
// channel (e.g. via a dashboard or DM), add an explicit guard here.
export const closeButton = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: close_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: tl.confirm,
    components: [confirmRow],
    flags: [MessageFlags.Ephemeral],
  });
};

export const confirmClose = async (client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: confirm_close_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.closing, components: [] });
  await ticketCloseEvent(client, interaction);
};

export const cancelClose = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: cancel_close_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.cancel, components: [] });
};
