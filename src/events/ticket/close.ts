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
import { enhancedLogger, LogCategory, lang, replyEphemeralError } from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';
import { claimAndArchiveTicket, reportTicketCloseOutcome } from '../../utils/ticket/claimAndArchive';
import { archiveAndCloseTicket } from '../../utils/ticket/closeWorkflow';

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
  //
  // Deleting the archive forum blanks the config's channelId (channelDelete)
  // instead of removing the row, so an empty id means "not configured" too —
  // otherwise every close fails later with a misleading transcript error.
  if (!archivedConfig?.channelId) {
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

  // The status guard above is check-then-set, so claimAndArchiveTicket flips
  // the status atomically (a lost race reports already-closed) and reverts it
  // if the archive fails, keeping the channel for a retry.
  const outcome = await claimAndArchiveTicket(
    client,
    ticket,
    guildId,
    channel,
    archivedConfig.channelId,
    {
      id: interaction.user.id,
      username: interaction.user.username,
    },
    deps,
  );
  await reportTicketCloseOutcome(interaction, outcome, deps.replyEphemeralError);
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
    new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel(tl.confirmL).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel(tl.cancelL).setStyle(ButtonStyle.Secondary),
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
