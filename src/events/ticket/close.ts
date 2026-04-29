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
import { enhancedLogger, LogCategory, lang } from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';
import { archiveAndCloseTicket } from '../../utils/ticket/closeWorkflow';

const tl = lang.ticket.close;
const ticketRepo = lazyRepo(Ticket);
const archivedTicketConfigRepo = lazyRepo(ArchivedTicketConfig);

export const ticketCloseEvent = async (client: Client, interaction: ButtonInteraction) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const channel = interaction.channel as GuildTextBasedChannel;
  const channelId = interaction.channelId || '';
  const archivedConfig = await archivedTicketConfigRepo.findOneBy({ guildId });
  const ticket = await ticketRepo.findOneBy({ guildId, channelId });

  if (!archivedConfig) {
    enhancedLogger.warn(lang.ticket.archiveTicketConfigNotFound, LogCategory.SYSTEM, { guildId });
    return;
  }

  if (!ticket) {
    enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.SYSTEM, { guildId, channelId });
    return;
  }

  // Prevent duplicate close (double-click race condition)
  if (ticket.status === 'closed') {
    enhancedLogger.warn('Ticket already closed, skipping duplicate archive', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });
    return;
  }

  // Immediately mark as closed to prevent concurrent close attempts
  await ticketRepo.update({ id: ticket.id, guildId }, { status: 'closed' });

  const result = await archiveAndCloseTicket(client, ticket, guildId, channel, archivedConfig.channelId);

  if (result.transcriptFailed && !interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: tl.transcriptCreate.error,
      flags: [MessageFlags.Ephemeral],
    });
  } else if (result.success && !result.archived) {
    // Ticket closed cleanly but forum archive post failed — ticket is gone,
    // channel is deleted. Log for operators; the user-facing close already happened.
    enhancedLogger.warn('Ticket closed but archive post failed', LogCategory.SYSTEM, {
      guildId,
      channelId,
      ticketId: ticket.id,
    });
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
