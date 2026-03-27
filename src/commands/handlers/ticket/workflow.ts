/**
 * Ticket Workflow Command Handlers
 *
 * Handles /ticket status, assign, unassign, info, workflow-enable,
 * workflow-disable, workflow-add-status, workflow-remove-status,
 * autoclose-enable, autoclose-disable subcommands.
 */

import {
  type CacheType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type GuildTextBasedChannel,
  MessageFlags,
} from 'discord.js';
import type { TicketStatusHistoryEntry } from '../../../typeorm/entities/ticket/Ticket';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig, type WorkflowStatus } from '../../../typeorm/entities/ticket/TicketConfig';
import {
  DEFAULT_TICKET_STATUSES,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  MAX,
  REQUIRED_WORKFLOW_STATUSES,
  requireAdmin,
  sanitizeUserInput,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { findStatusById, appendStatusHistory as sharedAppendHistory } from '../../../utils/workflow/workflowHelpers';

const tl = lang.ticket.workflow;
const tlInfo = lang.ticket.info;
const ticketConfigRepo = lazyRepo(TicketConfig);
const ticketRepo = lazyRepo(Ticket);

// ============================================================================
// Helper: Get ticket config with workflow check
// ============================================================================

async function getWorkflowConfig(
  guildId: string,
): Promise<{ config: TicketConfig | null; statuses: WorkflowStatus[] }> {
  const config = await ticketConfigRepo.findOneBy({ guildId });
  if (!config || !config.enableWorkflow) {
    return { config, statuses: [] };
  }
  const statuses = config.workflowStatuses || DEFAULT_TICKET_STATUSES;
  return { config, statuses };
}

// ============================================================================
// Helper: Get ticket by channel
// ============================================================================

async function getTicketByChannel(guildId: string, channelId: string): Promise<Ticket | null> {
  return ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId })
    .andWhere('ticket.channelId = :channelId', { channelId })
    .andWhere('ticket.status != :closed', { closed: 'closed' })
    .getOne();
}

// ============================================================================
// Helper: Map 'created' status to 'open' for workflow display
// ============================================================================

function mapStatus(status: string): string {
  return status === 'created' ? 'open' : status;
}

// ============================================================================
// Helper: Append to status history (capped at MAX entries)
// ============================================================================

function appendStatusHistory(ticket: Ticket, status: string, changedBy: string, note?: string): void {
  sharedAppendHistory(ticket, status, changedBy, MAX.TICKET_STATUS_HISTORY, note);
}

// ============================================================================
// Helper: Find status definition by ID
// ============================================================================

function findStatus(statuses: WorkflowStatus[], statusId: string): WorkflowStatus | undefined {
  return findStatusById(statuses, statusId);
}

// ============================================================================
// /ticket status <status>
// ============================================================================

export const ticketStatusHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  // Check workflow enabled
  const { config, statuses } = await getWorkflowConfig(guildId);
  if (!config?.enableWorkflow) {
    await interaction.reply({
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Find ticket by channel
  const ticket = await getTicketByChannel(guildId, channelId);
  if (!ticket) {
    await interaction.reply({
      content: tl.notInTicket,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const newStatusId = interaction.options.getString('status', true);
  const currentStatus = mapStatus(ticket.status);

  // Validate status
  const statusDef = findStatus(statuses, newStatusId);
  if (!statusDef) {
    const validIds = statuses.map(s => `\`${s.id}\``).join(', ');
    await interaction.reply({
      content: LANGF(tl.invalidStatus, newStatusId, validIds),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check if same
  if (currentStatus === newStatusId) {
    await interaction.reply({
      content: LANGF(tl.sameStatus, statusDef.label),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Update ticket
  ticket.status = newStatusId as Ticket['status'];
  ticket.lastActivityAt = new Date();
  appendStatusHistory(ticket, newStatusId, interaction.user.id);
  await ticketRepo.save(ticket);

  // Post status change embed in channel
  const embed = new EmbedBuilder()
    .setDescription(LANGF(tl.statusChanged, `${statusDef.emoji} ${statusDef.label}`, `<@${interaction.user.id}>`))
    .setColor(parseInt(statusDef.color.replace('#', ''), 16));

  await (interaction.channel as GuildTextBasedChannel)?.send({
    embeds: [embed],
  });

  // Reply ephemeral
  await interaction.reply({
    content: LANGF(tl.statusChanged, `${statusDef.emoji} ${statusDef.label}`, `<@${interaction.user.id}>`),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Ticket status changed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    ticketId: ticket.id,
    from: currentStatus,
    to: newStatusId,
    changedBy: interaction.user.id,
  });

  // If status is 'closed', the existing close flow will be triggered by the button
  // We don't auto-trigger archive here — user should use the close button for full archive
};

// ============================================================================
// /ticket assign <user>
// ============================================================================

export const ticketAssignHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const { config } = await getWorkflowConfig(guildId);
  if (!config?.enableWorkflow) {
    await interaction.reply({
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const ticket = await getTicketByChannel(guildId, channelId);
  if (!ticket) {
    await interaction.reply({
      content: tl.notInTicket,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const user = interaction.options.getUser('user', true);

  ticket.assignedTo = user.id;
  ticket.assignedAt = new Date();
  ticket.lastActivityAt = new Date();
  await ticketRepo.save(ticket);

  const embed = new EmbedBuilder().setDescription(LANGF(tl.assigned, `<@${user.id}>`)).setColor(0x5865f2);

  await (interaction.channel as GuildTextBasedChannel)?.send({
    embeds: [embed],
  });

  await interaction.reply({
    content: LANGF(tl.assigned, `<@${user.id}>`),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Ticket assigned', LogCategory.COMMAND_EXECUTION, {
    guildId,
    ticketId: ticket.id,
    assignedTo: user.id,
    assignedBy: interaction.user.id,
  });
};

// ============================================================================
// /ticket unassign
// ============================================================================

export const ticketUnassignHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const { config } = await getWorkflowConfig(guildId);
  if (!config?.enableWorkflow) {
    await interaction.reply({
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const ticket = await getTicketByChannel(guildId, channelId);
  if (!ticket) {
    await interaction.reply({
      content: tl.notInTicket,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!ticket.assignedTo) {
    await interaction.reply({
      content: tl.noAssignment,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const previousAssignee = ticket.assignedTo;
  ticket.assignedTo = null as unknown as string;
  ticket.assignedAt = null as unknown as Date;
  ticket.lastActivityAt = new Date();
  await ticketRepo.save(ticket);

  const embed = new EmbedBuilder().setDescription(tl.unassigned).setColor(0x808080);

  await (interaction.channel as GuildTextBasedChannel)?.send({
    embeds: [embed],
  });

  await interaction.reply({
    content: tl.unassigned,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Ticket unassigned', LogCategory.COMMAND_EXECUTION, {
    guildId,
    ticketId: ticket.id,
    previousAssignee,
    unassignedBy: interaction.user.id,
  });
};

// ============================================================================
// /ticket info
// ============================================================================

export const ticketInfoHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  // Info works even without workflow enabled (shows basic info)
  const ticket = await ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId })
    .andWhere('ticket.channelId = :channelId', { channelId })
    .andWhere('ticket.status != :closed', { closed: 'closed' })
    .getOne();

  if (!ticket) {
    await interaction.reply({
      content: tl.notInTicket,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const { config, statuses } = await getWorkflowConfig(guildId);
  const currentStatus = mapStatus(ticket.status);
  const statusDef = findStatus(statuses, currentStatus);

  const embed = new EmbedBuilder()
    .setTitle(tlInfo.title)
    .addFields(
      { name: tlInfo.createdBy, value: `<@${ticket.createdBy}>`, inline: true },
      {
        name: tlInfo.status,
        value: statusDef ? `${statusDef.emoji} ${statusDef.label}` : currentStatus,
        inline: true,
      },
      {
        name: tlInfo.assignedTo,
        value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : tlInfo.unassigned,
        inline: true,
      },
    )
    .setColor(statusDef ? parseInt(statusDef.color.replace('#', ''), 16) : 0x5865f2);

  if (ticket.type || ticket.customTypeId) {
    embed.addFields({
      name: tlInfo.ticketType,
      value: ticket.customTypeId || ticket.type || 'Unknown',
      inline: true,
    });
  }

  if (ticket.lastActivityAt) {
    embed.addFields({
      name: tlInfo.lastActivity,
      value: `<t:${Math.floor(new Date(ticket.lastActivityAt).getTime() / 1000)}:R>`,
      inline: true,
    });
  }

  // Status history (last 5)
  if (config?.enableWorkflow && ticket.statusHistory && ticket.statusHistory.length > 0) {
    const recentHistory = ticket.statusHistory.slice(-5).reverse();
    const historyText = recentHistory
      .map((entry: TicketStatusHistoryEntry) => {
        const entryStatusDef = findStatus(statuses, entry.status);
        const label = entryStatusDef ? `${entryStatusDef.emoji} ${entryStatusDef.label}` : entry.status;
        const timestamp = Math.floor(new Date(entry.changedAt).getTime() / 1000);
        return `${label} by <@${entry.changedBy}> <t:${timestamp}:R>`;
      })
      .join('\n');

    embed.addFields({ name: tlInfo.history, value: historyText });
  }

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
};

// ============================================================================
// /ticket workflow-enable
// ============================================================================

export const workflowEnableHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
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

  if (config.enableWorkflow) {
    await interaction.reply({
      content: tl.alreadyEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.enableWorkflow = true;
  if (!config.workflowStatuses || config.workflowStatuses.length === 0) {
    config.workflowStatuses = [...DEFAULT_TICKET_STATUSES];
  }
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: tl.enabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Ticket workflow enabled', LogCategory.COMMAND_EXECUTION, { guildId });
};

// ============================================================================
// /ticket workflow-disable
// ============================================================================

export const workflowDisableHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
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
      content: tl.alreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.enableWorkflow = false;
  // Don't delete workflowStatuses — preserved for re-enable
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: tl.disabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Ticket workflow disabled', LogCategory.COMMAND_EXECUTION, { guildId });
};

// ============================================================================
// /ticket workflow-add-status <id> <label> [emoji]
// ============================================================================

const STATUS_ID_REGEX = /^[a-z0-9-]{1,20}$/;

export const workflowAddStatusHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
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
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const statusId = interaction.options.getString('id', true).toLowerCase().trim();
  const label = sanitizeUserInput(interaction.options.getString('label', true).trim()).substring(0, 50);
  const emoji = interaction.options.getString('emoji') || '\uD83D\uDD35';

  // Validate ID format
  if (!STATUS_ID_REGEX.test(statusId)) {
    await interaction.reply({
      content: tl.invalidStatusId,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const statuses = config.workflowStatuses || [...DEFAULT_TICKET_STATUSES];

  // Check max
  if (statuses.length >= MAX.TICKET_WORKFLOW_STATUSES) {
    await interaction.reply({
      content: LANGF(tl.maxStatuses, MAX.TICKET_WORKFLOW_STATUSES),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check duplicate
  if (statuses.some(s => s.id === statusId)) {
    await interaction.reply({
      content: LANGF(tl.statusExists, statusId),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Insert before 'closed' (second to last position)
  const closedIndex = statuses.findIndex(s => s.id === 'closed');
  const newStatus: WorkflowStatus = {
    id: statusId,
    label,
    emoji,
    color: '#5865F2',
  };

  if (closedIndex >= 0) {
    statuses.splice(closedIndex, 0, newStatus);
  } else {
    statuses.push(newStatus);
  }

  config.workflowStatuses = statuses;
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: LANGF(tl.statusAdded, `${emoji} ${label}`),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Workflow status added', LogCategory.COMMAND_EXECUTION, {
    guildId,
    statusId,
    label,
  });
};

// ============================================================================
// /ticket workflow-remove-status <status>
// ============================================================================

export const workflowRemoveStatusHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
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
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const statusId = interaction.options.getString('status', true);

  // Check if required
  if (REQUIRED_WORKFLOW_STATUSES.includes(statusId)) {
    await interaction.reply({
      content: LANGF(tl.cannotRemoveRequired, statusId),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const statuses = config.workflowStatuses || [...DEFAULT_TICKET_STATUSES];
  const statusDef = statuses.find(s => s.id === statusId);

  if (!statusDef) {
    await interaction.reply({
      content: LANGF(tl.invalidStatus, statusId, statuses.map(s => `\`${s.id}\``).join(', ')),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check if tickets use this status
  const ticketsWithStatus = await ticketRepo.count({
    where: { guildId, status: statusId as Ticket['status'] },
  });

  // Remove the status
  config.workflowStatuses = statuses.filter(s => s.id !== statusId);
  await ticketConfigRepo.save(config);

  let reply = LANGF(tl.statusRemoved, `${statusDef.emoji} ${statusDef.label}`);
  if (ticketsWithStatus > 0) {
    reply += `\n${LANGF(tl.statusInUse, ticketsWithStatus.toString())}`;
  }

  await interaction.reply({ content: reply, flags: [MessageFlags.Ephemeral] });

  enhancedLogger.info('Workflow status removed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    statusId,
    ticketsAffected: ticketsWithStatus,
  });
};

// ============================================================================
// /ticket autoclose-enable [days] [warning-hours] [status]
// ============================================================================

export const autoCloseEnableHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
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
      content: tl.autoCloseRequiresWorkflow,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const days = interaction.options.getInteger('days') || config.autoCloseDays || 7;
  const warningHours = interaction.options.getInteger('warning-hours') || config.autoCloseWarningHours || 24;
  const status = interaction.options.getString('status') || config.autoCloseStatus || 'resolved';

  config.autoCloseEnabled = true;
  config.autoCloseDays = days;
  config.autoCloseWarningHours = warningHours;
  config.autoCloseStatus = status;
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: LANGF(tl.autoCloseEnabled, status, days.toString(), warningHours.toString()),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Auto-close enabled', LogCategory.COMMAND_EXECUTION, {
    guildId,
    days,
    warningHours,
    status,
  });
};

// ============================================================================
// /ticket autoclose-disable
// ============================================================================

export const autoCloseDisableHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
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

  if (!config.autoCloseEnabled) {
    await interaction.reply({
      content: tl.autoCloseAlreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.autoCloseEnabled = false;
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: tl.autoCloseDisabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Auto-close disabled', LogCategory.COMMAND_EXECUTION, {
    guildId,
  });
};

// ============================================================================
// Autocomplete: workflow statuses
// ============================================================================

export const workflowStatusAutocomplete = async (interaction: {
  guildId: string | null;
  respond: (choices: { name: string; value: string }[]) => Promise<void>;
}) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config?.enableWorkflow) {
    await interaction.respond([]);
    return;
  }

  const statuses = config.workflowStatuses || DEFAULT_TICKET_STATUSES;
  const choices = statuses.map(s => ({
    name: `${s.emoji} ${s.label}`,
    value: s.id,
  }));

  await interaction.respond(choices.slice(0, 25));
};

// ============================================================================
// Autocomplete: removable workflow statuses (excludes open/closed)
// ============================================================================

export const removableStatusAutocomplete = async (interaction: {
  guildId: string | null;
  respond: (choices: { name: string; value: string }[]) => Promise<void>;
}) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config?.enableWorkflow) {
    await interaction.respond([]);
    return;
  }

  const statuses = config.workflowStatuses || DEFAULT_TICKET_STATUSES;
  const choices = statuses
    .filter(s => !REQUIRED_WORKFLOW_STATUSES.includes(s.id))
    .map(s => ({
      name: `${s.emoji} ${s.label}`,
      value: s.id,
    }));

  await interaction.respond(choices.slice(0, 25));
};
