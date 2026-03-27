/**
 * Event Create / From-Template / Cancel / Recurring Handlers
 *
 * Creates Discord Scheduled Events via the guild.scheduledEvents API.
 */

import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
} from 'discord.js';
import eventLang from '../../../lang/event.json';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import type { RecurringPattern } from '../../../typeorm/entities/event/EventTemplate';
import { EventTemplate } from '../../../typeorm/entities/event/EventTemplate';
import { enhancedLogger, LANGF, LogCategory, parseTimeInput, requireAdmin, sanitizeUserInput } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const eventConfigRepo = lazyRepo(EventConfig);
const eventTemplateRepo = lazyRepo(EventTemplate);
const eventReminderRepo = lazyRepo(EventReminder);

const tl = eventLang;

/** Map entity type strings to Discord.js enum values */
function mapEntityType(type: string): GuildScheduledEventEntityType {
  switch (type) {
    case 'voice':
      return GuildScheduledEventEntityType.Voice;
    case 'stage':
      return GuildScheduledEventEntityType.StageInstance;
    default:
      return GuildScheduledEventEntityType.External;
  }
}

/** Create a reminder for an event */
async function createAutoReminder(
  guildId: string,
  discordEventId: string,
  eventTitle: string,
  startTime: Date,
  minutesBefore: number,
): Promise<void> {
  const reminderAt = new Date(startTime.getTime() - minutesBefore * 60 * 1000);
  if (reminderAt <= new Date()) return; // Don't create past reminders

  const reminder = eventReminderRepo.create({
    guildId,
    discordEventId,
    reminderAt,
    eventTitle,
  });
  await eventReminderRepo.save(reminder);
}

// ============================================================================
// Create
// ============================================================================

export async function handleEventCreate(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled) {
    await interaction.reply({
      content: tl.errors.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const title = sanitizeUserInput(interaction.options.getString('title', true));
  const startInput = interaction.options.getString('start', true);
  const description = interaction.options.getString('description', false);
  const channel = interaction.options.getChannel('channel', false);
  const duration = interaction.options.getInteger('duration', false) || 60;
  const location = interaction.options.getString('location', false);

  // Parse start time
  const startDate = parseTimeInput(startInput);
  if (!startDate) {
    await interaction.reply({
      content: tl.create.invalidStart,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (startDate <= new Date()) {
    await interaction.reply({
      content: tl.create.startInPast,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Determine entity type
  const isExternal = !channel;
  const entityType = isExternal
    ? GuildScheduledEventEntityType.External
    : channel.type === 13 // StageChannel
      ? GuildScheduledEventEntityType.StageInstance
      : GuildScheduledEventEntityType.Voice;

  if (isExternal && !location) {
    await interaction.reply({
      content: tl.create.missingChannel,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const eventData: Parameters<typeof interaction.guild.scheduledEvents.create>[0] = {
      name: title,
      scheduledStartTime: startDate,
      scheduledEndTime: endDate,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType,
      description: description ? sanitizeUserInput(description) : undefined,
    };

    if (isExternal) {
      eventData.entityMetadata = { location: location || 'TBD' };
    } else {
      eventData.channel = channel.id;
    }

    const scheduledEvent = await interaction.guild.scheduledEvents.create(eventData);

    // Create auto-reminder if configured
    if (config.reminderChannelId && config.defaultReminderMinutes > 0) {
      await createAutoReminder(guildId, scheduledEvent.id, title, startDate, config.defaultReminderMinutes);
    }

    let replyContent = LANGF(tl.create.success, title);
    if (config.reminderChannelId && config.defaultReminderMinutes > 0) {
      replyContent += `\n${LANGF(tl.create.reminderSet, config.defaultReminderMinutes.toString())}`;
    }

    await interaction.editReply({ content: replyContent });

    enhancedLogger.command(`Event '${title}' created`, interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Event create failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    const content = tl.create.error;
    if (interaction.deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  }
}

// ============================================================================
// From Template
// ============================================================================

export async function handleFromTemplate(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled) {
    await interaction.reply({
      content: tl.errors.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const templateName = interaction.options.getString('template', true);
  const startInput = interaction.options.getString('start', true);

  const template = await eventTemplateRepo.findOneBy({ guildId, name: templateName });
  if (!template) {
    await interaction.reply({
      content: tl.fromTemplate.templateNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const startDate = parseTimeInput(startInput);
  if (!startDate) {
    await interaction.reply({
      content: tl.create.invalidStart,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (startDate <= new Date()) {
    await interaction.reply({
      content: tl.create.startInPast,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const endDate = new Date(startDate.getTime() + template.defaultDurationMinutes * 60 * 1000);

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const entityType = mapEntityType(template.entityType);

    const eventData: Parameters<typeof interaction.guild.scheduledEvents.create>[0] = {
      name: template.title,
      scheduledStartTime: startDate,
      scheduledEndTime: endDate,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType,
      description: template.description || undefined,
    };

    if (entityType === GuildScheduledEventEntityType.External) {
      eventData.entityMetadata = { location: template.location || 'TBD' };
    }

    const scheduledEvent = await interaction.guild.scheduledEvents.create(eventData);

    // Create auto-reminder
    if (config.reminderChannelId && config.defaultReminderMinutes > 0) {
      await createAutoReminder(guildId, scheduledEvent.id, template.title, startDate, config.defaultReminderMinutes);
    }

    await interaction.editReply({
      content: LANGF(tl.fromTemplate.success, template.title),
    });

    enhancedLogger.command(`Event created from template '${templateName}'`, interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Event from-template failed', error as Error, LogCategory.COMMAND_EXECUTION, { guildId });
    const content = tl.fromTemplate.error;
    if (interaction.deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  }
}

// ============================================================================
// Cancel
// ============================================================================

export async function handleEventCancel(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const eventId = interaction.options.getString('event', true);

  try {
    const scheduledEvent = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);

    if (!scheduledEvent) {
      await interaction.reply({
        content: tl.cancel.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await scheduledEvent.delete();

    // Clean up reminders
    await eventReminderRepo.delete({ guildId, discordEventId: eventId });

    await interaction.reply({
      content: LANGF(tl.cancel.success, scheduledEvent.name),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command(`Event '${scheduledEvent.name}' cancelled`, interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Event cancel failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: tl.cancel.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// ============================================================================
// Recurring
// ============================================================================

export async function handleRecurring(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled) {
    await interaction.reply({
      content: tl.errors.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const templateName = interaction.options.getString('template', true);
  const startInput = interaction.options.getString('start', true);
  const pattern = interaction.options.getString('pattern', true) as RecurringPattern;

  const template = await eventTemplateRepo.findOneBy({ guildId, name: templateName });
  if (!template) {
    await interaction.reply({
      content: tl.recurring.templateNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const startDate = parseTimeInput(startInput);
  if (!startDate) {
    await interaction.reply({
      content: tl.create.invalidStart,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (startDate <= new Date()) {
    await interaction.reply({
      content: tl.create.startInPast,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Update template to be recurring
  template.isRecurring = true;
  template.recurringPattern = pattern;
  await eventTemplateRepo.save(template);

  const endDate = new Date(startDate.getTime() + template.defaultDurationMinutes * 60 * 1000);

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const entityType = mapEntityType(template.entityType);

    const eventData: Parameters<typeof interaction.guild.scheduledEvents.create>[0] = {
      name: template.title,
      scheduledStartTime: startDate,
      scheduledEndTime: endDate,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType,
      description: template.description || undefined,
    };

    if (entityType === GuildScheduledEventEntityType.External) {
      eventData.entityMetadata = { location: template.location || 'TBD' };
    }

    const scheduledEvent = await interaction.guild.scheduledEvents.create(eventData);

    // Create auto-reminder
    if (config.reminderChannelId && config.defaultReminderMinutes > 0) {
      await createAutoReminder(guildId, scheduledEvent.id, template.title, startDate, config.defaultReminderMinutes);
    }

    const startTimestamp = `<t:${Math.floor(startDate.getTime() / 1000)}:F>`;

    await interaction.editReply({
      content: LANGF(tl.recurring.success, template.title, pattern, startTimestamp),
    });

    enhancedLogger.command(`Recurring event '${template.title}' created (${pattern})`, interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Recurring event create failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    const content = tl.recurring.error;
    if (interaction.deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  }
}
