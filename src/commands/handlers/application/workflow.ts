/**
 * Application Workflow Command Handlers
 *
 * Handles /application status, note, claim, info, check,
 * workflow-enable, workflow-disable, workflow-add-status, workflow-remove-status.
 */

import {
  type CacheType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type GuildTextBasedChannel,
  MessageFlags,
} from 'discord.js';
import type { ApplicationStatusHistoryEntry } from '../../../typeorm/entities/application/Application';
import { Application } from '../../../typeorm/entities/application/Application';
import {
  ApplicationConfig,
  type ApplicationWorkflowStatus,
} from '../../../typeorm/entities/application/ApplicationConfig';
import {
  createToggleHandler,
  DEFAULT_APPLICATION_STATUSES,
  enhancedLogger,
  formatLang,
  guardFeatureAccess,
  LogCategory,
  lang,
  MAX,
  REQUIRED_APPLICATION_STATUSES,
  replyEphemeralError,
  sanitizeUserInput,
  toUnixSeconds,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { findStatusById, appendStatusHistory as sharedAppendHistory } from '../../../utils/workflow/workflowHelpers';

const tl = lang.application.workflow;
const tlInfo = lang.application.workflowInfo;
const applicationConfigRepo = lazyRepo(ApplicationConfig);
const applicationRepo = lazyRepo(Application);

// ============================================================================
// Helper: Get application config with workflow check
// ============================================================================

async function getWorkflowConfig(guildId: string): Promise<{
  config: ApplicationConfig | null;
  statuses: ApplicationWorkflowStatus[];
}> {
  const config = await applicationConfigRepo.findOneBy({ guildId });
  if (!config?.enableWorkflow) {
    return { config, statuses: [] };
  }
  const statuses = config.workflowStatuses || DEFAULT_APPLICATION_STATUSES;
  return { config, statuses };
}

// ============================================================================
// Helper: Get application by channel
// ============================================================================

async function getApplicationByChannel(guildId: string, channelId: string): Promise<Application | null> {
  return applicationRepo
    .createQueryBuilder('app')
    .where('app.guildId = :guildId', { guildId })
    .andWhere('app.channelId = :channelId', { channelId })
    .andWhere('app.status != :closed', { closed: 'closed' })
    .getOne();
}

// ============================================================================
// Helper: Map 'created' status to 'submitted' for workflow display
// ============================================================================

function mapStatus(status: string): string {
  return status === 'created' ? 'submitted' : status;
}

// ============================================================================
// Helper: Append to status history (capped at MAX entries)
// ============================================================================

function appendStatusHistory(application: Application, status: string, changedBy: string, note?: string): void {
  sharedAppendHistory(application, status, changedBy, MAX.APPLICATION_STATUS_HISTORY, note);
}

// ============================================================================
// /application status <status>
// ============================================================================

export async function applicationStatusHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const { config, statuses } = await getWorkflowConfig(guildId);
  if (!config?.enableWorkflow) {
    await replyEphemeralError(interaction, tl.notEnabled);
    return;
  }

  const application = await getApplicationByChannel(guildId, channelId);
  if (!application) {
    await replyEphemeralError(interaction, tl.notInApplication);
    return;
  }

  const newStatusId = interaction.options.getString('status', true);
  const currentStatus = mapStatus(application.status);

  const statusDef = findStatusById(statuses, newStatusId);
  if (!statusDef) {
    const validIds = statuses.map(s => `\`${s.id}\``).join(', ');
    await replyEphemeralError(interaction, formatLang(tl.invalidStatus, newStatusId, validIds));
    return;
  }

  if (currentStatus === newStatusId) {
    await replyEphemeralError(interaction, formatLang(tl.sameStatus, statusDef.label));
    return;
  }

  application.status = newStatusId as Application['status'];
  appendStatusHistory(application, newStatusId, interaction.user.id);
  await applicationRepo.save(application);

  const embed = new EmbedBuilder()
    .setDescription(formatLang(tl.statusChanged, `${statusDef.emoji} ${statusDef.label}`, `<@${interaction.user.id}>`))
    .setColor(parseInt(statusDef.color.replace('#', ''), 16));

  await (interaction.channel as GuildTextBasedChannel)?.send({
    embeds: [embed],
  });

  await interaction.reply({
    content: formatLang(tl.statusChanged, `${statusDef.emoji} ${statusDef.label}`, `<@${interaction.user.id}>`),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Application status changed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    applicationId: application.id,
    from: currentStatus,
    to: newStatusId,
    changedBy: interaction.user.id,
  });
}

// ============================================================================
// /application note <text>
// ============================================================================

export async function applicationNoteHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const { config } = await getWorkflowConfig(guildId);
  if (!config?.enableWorkflow) {
    await replyEphemeralError(interaction, tl.notEnabled);
    return;
  }

  const application = await getApplicationByChannel(guildId, channelId);
  if (!application) {
    await replyEphemeralError(interaction, tl.notInApplication);
    return;
  }

  const noteText = sanitizeUserInput(interaction.options.getString('text', true), {
    maxLength: 1000,
  });

  if (noteText.length > 1000) {
    await replyEphemeralError(interaction, tl.noteTooLong);
    return;
  }

  const notes = application.internalNotes || [];
  notes.push({
    note: noteText,
    addedBy: interaction.user.id,
    addedAt: new Date().toISOString(),
  });

  // Trim oldest notes if over limit
  if (notes.length > MAX.APPLICATION_INTERNAL_NOTES) {
    application.internalNotes = notes.slice(notes.length - MAX.APPLICATION_INTERNAL_NOTES);
  } else {
    application.internalNotes = notes;
  }

  await applicationRepo.save(application);

  await interaction.reply({
    content: formatLang(tl.noteAdded, `<@${interaction.user.id}>`),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Application note added', LogCategory.COMMAND_EXECUTION, {
    guildId,
    applicationId: application.id,
    addedBy: interaction.user.id,
  });
}

// ============================================================================
// /application claim
// ============================================================================

export async function applicationClaimHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const { config } = await getWorkflowConfig(guildId);
  if (!config?.enableWorkflow) {
    await replyEphemeralError(interaction, tl.notEnabled);
    return;
  }

  const application = await getApplicationByChannel(guildId, channelId);
  if (!application) {
    await replyEphemeralError(interaction, tl.notInApplication);
    return;
  }

  if (application.reviewedBy) {
    await replyEphemeralError(interaction, formatLang(tl.alreadyClaimed, application.reviewedBy));
    return;
  }

  application.reviewedBy = interaction.user.id;
  application.reviewedAt = new Date();
  await applicationRepo.save(application);

  const embed = new EmbedBuilder()
    .setDescription(formatLang(tl.claimed, `<@${interaction.user.id}>`))
    .setColor(0x5865f2);

  await (interaction.channel as GuildTextBasedChannel)?.send({
    embeds: [embed],
  });

  await interaction.reply({
    content: formatLang(tl.claimed, `<@${interaction.user.id}>`),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Application claimed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    applicationId: application.id,
    claimedBy: interaction.user.id,
  });
}

// ============================================================================
// /application info
// ============================================================================

export async function applicationInfoHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'use');
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;
  const channelId = interaction.channelId;

  const application = await applicationRepo
    .createQueryBuilder('app')
    .where('app.guildId = :guildId', { guildId })
    .andWhere('app.channelId = :channelId', { channelId })
    .andWhere('app.status != :closed', { closed: 'closed' })
    .getOne();

  if (!application) {
    await replyEphemeralError(interaction, tl.notInApplication);
    return;
  }

  const { config, statuses } = await getWorkflowConfig(guildId);
  const currentStatus = mapStatus(application.status);
  const statusDef = findStatusById(statuses, currentStatus);

  const embed = new EmbedBuilder()
    .setTitle(tlInfo.title)
    .addFields(
      {
        name: tlInfo.createdBy,
        value: `<@${application.createdBy}>`,
        inline: true,
      },
      {
        name: tlInfo.status,
        value: statusDef ? `${statusDef.emoji} ${statusDef.label}` : currentStatus,
        inline: true,
      },
      {
        name: tlInfo.reviewer,
        value: application.reviewedBy ? `<@${application.reviewedBy}>` : tlInfo.unassigned,
        inline: true,
      },
    )
    .setColor(statusDef ? parseInt(statusDef.color.replace('#', ''), 16) : 0x5865f2);

  if (application.type) {
    embed.addFields({
      name: tlInfo.position,
      value: application.type,
      inline: true,
    });
  }

  // Internal notes (last 5)
  if (application.internalNotes && application.internalNotes.length > 0) {
    const recentNotes = application.internalNotes.slice(-5).reverse();
    const notesText = recentNotes
      .map(n => {
        const timestamp = toUnixSeconds(new Date(n.addedAt));
        return formatLang(tlInfo.noteEntry, n.note, n.addedBy, timestamp.toString());
      })
      .join('\n');

    embed.addFields({
      name: formatLang(tlInfo.notesTitle, application.internalNotes.length.toString()),
      value: notesText,
    });
  }

  // Status history (last 5)
  if (config?.enableWorkflow && application.statusHistory && application.statusHistory.length > 0) {
    const recentHistory = application.statusHistory.slice(-5).reverse();
    const historyText = recentHistory
      .map((entry: ApplicationStatusHistoryEntry) => {
        const entryStatusDef = findStatusById(statuses, entry.status);
        const label = entryStatusDef ? `${entryStatusDef.emoji} ${entryStatusDef.label}` : entry.status;
        const timestamp = toUnixSeconds(new Date(entry.changedAt));
        return `${label} by <@${entry.changedBy}> <t:${timestamp}:R>`;
      })
      .join('\n');

    embed.addFields({ name: tlInfo.history, value: historyText });
  }

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

// ============================================================================
// /application check (applicant self-check)
// ============================================================================

export async function applicationCheckHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  const { statuses } = await getWorkflowConfig(guildId);

  // Find the user's most recent open application in this guild
  const application = await applicationRepo
    .createQueryBuilder('app')
    .where('app.guildId = :guildId', { guildId })
    .andWhere('app.createdBy = :userId', { userId })
    .andWhere('app.status != :closed', { closed: 'closed' })
    .orderBy('app.id', 'DESC')
    .getOne();

  if (!application) {
    await interaction.reply({
      content: tl.checkNoApplication,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const currentStatus = mapStatus(application.status);
  const statusDef = findStatusById(statuses, currentStatus);

  const embed = new EmbedBuilder()
    .setTitle(tl.checkTitle)
    .addFields(
      {
        name: tl.checkPosition,
        value: application.type || 'General',
        inline: true,
      },
      {
        name: tl.checkStatus,
        value: statusDef ? `${statusDef.emoji} ${statusDef.label}` : currentStatus,
        inline: true,
      },
      {
        name: tl.checkReviewedBy,
        value: application.reviewedBy ? `<@${application.reviewedBy}>` : tl.checkUnassigned,
        inline: true,
      },
    )
    .setColor(statusDef ? parseInt(statusDef.color.replace('#', ''), 16) : 0x5865f2);

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

// ============================================================================
// /application workflow-enable
// ============================================================================

const workflowToggle = createToggleHandler({
  repo: applicationConfigRepo,
  field: 'enableWorkflow',
  messages: {
    alreadyEnabled: tl.alreadyEnabled,
    alreadyDisabled: tl.alreadyDisabled,
    enabled: tl.enabled,
    disabled: tl.disabled,
  },
  requireExisting: { notConfigured: lang.application.applicationConfigNotFound },
  onEnable: config => {
    if (!config.workflowStatuses || config.workflowStatuses.length === 0) {
      config.workflowStatuses = DEFAULT_APPLICATION_STATUSES.map(s => ({ ...s }));
    }
  },
  onToggled: (_interaction, guildId, enabled) =>
    enhancedLogger.info(`Application workflow ${enabled ? 'enabled' : 'disabled'}`, LogCategory.COMMAND_EXECUTION, {
      guildId,
    }),
});

export async function applicationWorkflowEnableHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
  if (!guard.allowed) return;
  await workflowToggle.enable(interaction, interaction.guildId!);
}

// ============================================================================
// /application workflow-disable
// ============================================================================

export async function applicationWorkflowDisableHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
  if (!guard.allowed) return;
  await workflowToggle.disable(interaction, interaction.guildId!);
}

// ============================================================================
// /application workflow-add-status <id> <label> [emoji]
// ============================================================================

const STATUS_ID_REGEX = /^[a-z0-9-]{1,20}$/;

export async function applicationWorkflowAddStatusHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;
  const config = await applicationConfigRepo.findOneBy({ guildId });

  if (!config) {
    await replyEphemeralError(interaction, lang.application.applicationConfigNotFound);
    return;
  }

  if (!config.enableWorkflow) {
    await replyEphemeralError(interaction, tl.notEnabled);
    return;
  }

  const statusId = interaction.options.getString('id', true).toLowerCase().trim();
  const label = sanitizeUserInput(interaction.options.getString('label', true).trim()).substring(0, 50);
  const emoji = interaction.options.getString('emoji') || '\uD83D\uDD35';

  if (!STATUS_ID_REGEX.test(statusId)) {
    await replyEphemeralError(interaction, tl.invalidStatusId);
    return;
  }

  const statuses = config.workflowStatuses || [...DEFAULT_APPLICATION_STATUSES];

  if (statuses.length >= MAX.APPLICATION_WORKFLOW_STATUSES) {
    await replyEphemeralError(interaction, formatLang(tl.maxStatuses, MAX.APPLICATION_WORKFLOW_STATUSES));
    return;
  }

  if (statuses.some(s => s.id === statusId)) {
    await replyEphemeralError(interaction, formatLang(tl.statusExists, statusId));
    return;
  }

  // Insert before 'denied' (keep denied/on-hold at end)
  const deniedIndex = statuses.findIndex(s => s.id === 'denied');
  const newStatus: ApplicationWorkflowStatus = {
    id: statusId,
    label,
    emoji,
    color: '#5865F2',
  };

  if (deniedIndex >= 0) {
    statuses.splice(deniedIndex, 0, newStatus);
  } else {
    statuses.push(newStatus);
  }

  config.workflowStatuses = statuses;
  await applicationConfigRepo.save(config);

  await interaction.reply({
    content: formatLang(tl.statusAdded, `${emoji} ${label}`),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Application workflow status added', LogCategory.COMMAND_EXECUTION, {
    guildId,
    statusId,
    label,
  });
}

// ============================================================================
// /application workflow-remove-status <status>
// ============================================================================

export async function applicationWorkflowRemoveStatusHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'applications', 'manage');
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;
  const config = await applicationConfigRepo.findOneBy({ guildId });

  if (!config) {
    await replyEphemeralError(interaction, lang.application.applicationConfigNotFound);
    return;
  }

  if (!config.enableWorkflow) {
    await replyEphemeralError(interaction, tl.notEnabled);
    return;
  }

  const statusId = interaction.options.getString('status', true);

  if (REQUIRED_APPLICATION_STATUSES.includes(statusId)) {
    await replyEphemeralError(interaction, formatLang(tl.cannotRemoveRequired, statusId));
    return;
  }

  const statuses = config.workflowStatuses || [...DEFAULT_APPLICATION_STATUSES];
  const statusDef = statuses.find(s => s.id === statusId);

  if (!statusDef) {
    await interaction.reply({
      content: formatLang(tl.invalidStatus, statusId, statuses.map(s => `\`${s.id}\``).join(', ')),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const applicationsWithStatus = await applicationRepo.count({
    where: { guildId, status: statusId as Application['status'] },
  });

  config.workflowStatuses = statuses.filter(s => s.id !== statusId);
  await applicationConfigRepo.save(config);

  let reply = formatLang(tl.statusRemoved, `${statusDef.emoji} ${statusDef.label}`);
  if (applicationsWithStatus > 0) {
    reply += `\n${formatLang(tl.statusInUse, applicationsWithStatus.toString())}`;
  }

  await interaction.reply({ content: reply, flags: [MessageFlags.Ephemeral] });

  enhancedLogger.info('Application workflow status removed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    statusId,
    applicationsAffected: applicationsWithStatus,
  });
}

// ============================================================================
// Autocomplete: application workflow statuses
// ============================================================================

export async function applicationWorkflowStatusAutocomplete(interaction: {
  guildId: string | null;
  respond: (choices: { name: string; value: string }[]) => Promise<void>;
}) {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const config = await applicationConfigRepo.findOneBy({ guildId });

  if (!config?.enableWorkflow) {
    await interaction.respond([]);
    return;
  }

  const statuses = config.workflowStatuses || DEFAULT_APPLICATION_STATUSES;
  const choices = statuses.map(s => ({
    name: `${s.emoji} ${s.label}`,
    value: s.id,
  }));

  await interaction.respond(choices.slice(0, 25));
}

// ============================================================================
// Autocomplete: removable application workflow statuses
// ============================================================================

export async function applicationRemovableStatusAutocomplete(interaction: {
  guildId: string | null;
  respond: (choices: { name: string; value: string }[]) => Promise<void>;
}) {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const config = await applicationConfigRepo.findOneBy({ guildId });

  if (!config?.enableWorkflow) {
    await interaction.respond([]);
    return;
  }

  const statuses = config.workflowStatuses || DEFAULT_APPLICATION_STATUSES;
  const choices = statuses
    .filter(s => !REQUIRED_APPLICATION_STATUSES.includes(s.id))
    .map(s => ({
      name: `${s.emoji} ${s.label}`,
      value: s.id,
    }));

  await interaction.respond(choices.slice(0, 25));
}
