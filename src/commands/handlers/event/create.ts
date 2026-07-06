/**
 * Event Create / From-Template / Cancel / Recurring Handlers
 *
 * Creates Discord Scheduled Events via the guild.scheduledEvents API.
 */

import {
  type AutocompleteInteraction,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
} from 'discord.js';
import { lang } from '../../../lang';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import type { RecurringPattern } from '../../../typeorm/entities/event/EventTemplate';
import { EventTemplate } from '../../../typeorm/entities/event/EventTemplate';
import {
  enhancedLogger,
  formatLang,
  guardFeatureAccess,
  LogCategory,
  parseTimeInput,
  replyEphemeralError,
  sanitizeUserInput,
  toUnixSeconds,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

// Locale-aware (Proxy fallback) — was a direct en JSON import that bypassed i18n.
const eventLang = lang.event;

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
  const guard = await guardFeatureAccess(interaction, 'events', 'manage');
  if (!guard.allowed) return;

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled) {
    await replyEphemeralError(interaction, tl.errors.notEnabled);
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
    await replyEphemeralError(interaction, tl.create.invalidStart);
    return;
  }

  if (startDate <= new Date()) {
    await replyEphemeralError(interaction, tl.create.startInPast);
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
    await replyEphemeralError(interaction, tl.create.missingChannel);
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

    let replyContent = formatLang(tl.create.success, title);
    if (config.reminderChannelId && config.defaultReminderMinutes > 0) {
      replyContent += `\n${formatLang(tl.create.reminderSet, config.defaultReminderMinutes.toString())}`;
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
  const guard = await guardFeatureAccess(interaction, 'events', 'manage');
  if (!guard.allowed) return;

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled) {
    await replyEphemeralError(interaction, tl.errors.notEnabled);
    return;
  }

  const templateName = interaction.options.getString('template', true);
  const startInput = interaction.options.getString('start', true);

  const template = await eventTemplateRepo.findOneBy({
    guildId,
    name: templateName,
  });
  if (!template) {
    await replyEphemeralError(interaction, tl.fromTemplate.templateNotFound);
    return;
  }

  const startDate = parseTimeInput(startInput);
  if (!startDate) {
    await replyEphemeralError(interaction, tl.create.invalidStart);
    return;
  }

  if (startDate <= new Date()) {
    await replyEphemeralError(interaction, tl.create.startInPast);
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
      content: formatLang(tl.fromTemplate.success, template.title),
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

/**
 * Autocomplete for the 'event' option on /event cancel + /event remind —
 * suggests the guild's live scheduled events by name, resolving to the id
 * the handlers fetch with.
 */
export async function scheduledEventAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.respond([]);
    return;
  }
  try {
    const events = await interaction.guild.scheduledEvents.fetch();
    const focused = interaction.options.getFocused().toLowerCase();
    const filtered = focused ? events.filter(e => e.name.toLowerCase().includes(focused)) : events;
    await interaction.respond([...filtered.values()].slice(0, 25).map(e => ({ name: e.name, value: e.id })));
  } catch (error) {
    // Best-effort: an empty dropdown is the correct UX, but the failure is
    // still worth a trace (debug — routine permission misses would spam
    // anything louder).
    enhancedLogger.debug('Scheduled-event autocomplete fetch failed', LogCategory.COMMAND_EXECUTION, {
      guildId: interaction.guildId ?? undefined,
      reason: error instanceof Error ? error.message : String(error),
    });
    await interaction.respond([]).catch(() => null);
  }
}

export async function handleEventCancel(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const guard = await guardFeatureAccess(interaction, 'events', 'manage');
  if (!guard.allowed) return;

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const eventId = interaction.options.getString('event', true);

  try {
    const scheduledEvent = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);

    if (!scheduledEvent) {
      await replyEphemeralError(interaction, tl.cancel.notFound);
      return;
    }

    await scheduledEvent.delete();

    // Clean up reminders
    await eventReminderRepo.delete({ guildId, discordEventId: eventId });

    await interaction.reply({
      content: formatLang(tl.cancel.success, scheduledEvent.name),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command(`Event '${scheduledEvent.name}' cancelled`, interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Event cancel failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await replyEphemeralError(interaction, tl.cancel.error);
  }
}

// ============================================================================
// Recurring
// ============================================================================

export async function handleRecurring(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const guard = await guardFeatureAccess(interaction, 'events', 'manage');
  if (!guard.allowed) return;

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled) {
    await replyEphemeralError(interaction, tl.errors.notEnabled);
    return;
  }

  const templateName = interaction.options.getString('template', true);
  const startInput = interaction.options.getString('start', true);
  const pattern = interaction.options.getString('pattern', true) as RecurringPattern;

  const template = await eventTemplateRepo.findOneBy({
    guildId,
    name: templateName,
  });
  if (!template) {
    await replyEphemeralError(interaction, tl.recurring.templateNotFound);
    return;
  }

  const startDate = parseTimeInput(startInput);
  if (!startDate) {
    await replyEphemeralError(interaction, tl.create.invalidStart);
    return;
  }

  if (startDate <= new Date()) {
    await replyEphemeralError(interaction, tl.create.startInPast);
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

    const startTimestamp = `<t:${toUnixSeconds(startDate)}:F>`;

    await interaction.editReply({
      content: formatLang(tl.recurring.success, template.title, pattern, startTimestamp),
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
