import { type ButtonInteraction, type Client, type GuildTextBasedChannel, MessageFlags } from 'discord.js';
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
  }
};
