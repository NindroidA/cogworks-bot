/**
 * Ticket SLA Command Handlers
 *
 * Handles /ticket sla-enable, sla-disable, sla-per-type, sla-stats subcommands.
 */

import {
  type CacheType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { enhancedLogger, LANGF, LogCategory, lang, requireAdmin } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.ticket.sla;
const ticketConfigRepo = lazyRepo(TicketConfig);
const ticketRepo = lazyRepo(Ticket);

// ============================================================================
// /ticket sla-enable [target-minutes] [breach-channel]
// ============================================================================

export const slaEnableHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!config.enableWorkflow) {
    await interaction.reply({
      content: tl.requiresWorkflow,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (config.slaEnabled) {
    await interaction.reply({
      content: tl.alreadyEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const targetMinutes = interaction.options.getInteger('target-minutes') || 60;
  const breachChannel = interaction.options.getChannel('breach-channel');

  config.slaEnabled = true;
  config.slaTargetMinutes = targetMinutes;
  if (breachChannel) {
    config.slaBreachChannelId = breachChannel.id;
  }
  await ticketConfigRepo.save(config);

  const reply = breachChannel
    ? LANGF(tl.enabled, targetMinutes.toString(), `<#${breachChannel.id}>`)
    : LANGF(tl.enabledNoChannel, targetMinutes.toString());

  await interaction.reply({
    content: reply,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('SLA tracking enabled', LogCategory.COMMAND_EXECUTION, {
    guildId,
    targetMinutes,
    breachChannelId: breachChannel?.id || null,
  });
};

// ============================================================================
// /ticket sla-disable
// ============================================================================

export const slaDisableHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!config.slaEnabled) {
    await interaction.reply({
      content: tl.alreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.slaEnabled = false;
  // Preserve configuration for re-enabling
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: tl.disabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('SLA tracking disabled', LogCategory.COMMAND_EXECUTION, { guildId });
};

// ============================================================================
// /ticket sla-per-type <type> [minutes]
// ============================================================================

export const slaPerTypeHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!config.slaEnabled) {
    await interaction.reply({
      content: tl.alreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const typeId = interaction.options.getString('type', true);
  const minutes = interaction.options.getInteger('minutes');

  const perType = config.slaPerType || {};

  if (minutes === null || minutes === undefined) {
    // Remove override
    if (!(typeId in perType)) {
      await interaction.reply({
        content: LANGF(tl.perTypeNotFound, typeId),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    delete perType[typeId];
    config.slaPerType = Object.keys(perType).length > 0 ? perType : null;
    await ticketConfigRepo.save(config);

    await interaction.reply({
      content: LANGF(tl.perTypeRemoved, typeId, config.slaTargetMinutes.toString()),
      flags: [MessageFlags.Ephemeral],
    });
  } else {
    // Set override
    perType[typeId] = minutes;
    config.slaPerType = perType;
    await ticketConfigRepo.save(config);

    await interaction.reply({
      content: LANGF(tl.perTypeSet, typeId, minutes.toString()),
      flags: [MessageFlags.Ephemeral],
    });
  }

  enhancedLogger.info('SLA per-type updated', LogCategory.COMMAND_EXECUTION, {
    guildId,
    typeId,
    minutes,
  });
};

// ============================================================================
// /ticket sla-stats [days]
// ============================================================================

export const slaStatsHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const days = interaction.options.getInteger('days') || 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get tickets in the date range (using lastActivityAt as a proxy for creation time)
  const tickets = await ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId })
    .andWhere('ticket.lastActivityAt >= :cutoff', { cutoff })
    .getMany();

  if (tickets.length === 0) {
    await interaction.reply({
      content: tl.statsNoData,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Calculate statistics
  const totalTickets = tickets.length;
  const breachedCount = tickets.filter(t => t.slaBreached).length;

  // Calculate average first response time for tickets that have one
  const respondedTickets = tickets.filter(t => t.firstResponseAt);
  let avgResponseMinutes = 0;

  if (respondedTickets.length > 0) {
    const totalResponseMs = respondedTickets.reduce((sum, t) => {
      const created = getTicketCreationTime(t);
      const responded = new Date(t.firstResponseAt!).getTime();
      return sum + (responded - created);
    }, 0);
    avgResponseMinutes = Math.round(totalResponseMs / respondedTickets.length / 60_000);
  }

  const complianceRate =
    totalTickets > 0 ? Math.round(((totalTickets - breachedCount) / totalTickets) * 100) : 100;

  const embed = new EmbedBuilder()
    .setTitle(LANGF(tl.statsTitle, days.toString()))
    .addFields(
      {
        name: tl.statsTotalTickets,
        value: totalTickets.toString(),
        inline: true,
      },
      {
        name: tl.statsAvgResponse,
        value:
          respondedTickets.length > 0
            ? LANGF(tl.statsMinutes, avgResponseMinutes.toString())
            : 'N/A',
        inline: true,
      },
      {
        name: tl.statsComplianceRate,
        value: LANGF(tl.statsPercent, complianceRate.toString()),
        inline: true,
      },
      {
        name: tl.statsBreachCount,
        value: breachedCount.toString(),
        inline: true,
      },
    )
    .setColor(complianceRate >= 90 ? 0x00ff00 : complianceRate >= 70 ? 0xffa500 : 0xff0000)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
};

// ============================================================================
// Helper: Approximate ticket creation time
// ============================================================================

function getTicketCreationTime(ticket: Ticket): number {
  if (ticket.statusHistory && ticket.statusHistory.length > 0) {
    const earliest = ticket.statusHistory[0];
    if (earliest.changedAt) {
      return new Date(earliest.changedAt).getTime();
    }
  }
  return new Date(ticket.lastActivityAt).getTime();
}
