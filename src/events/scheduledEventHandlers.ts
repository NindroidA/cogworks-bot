/**
 * Scheduled Event Handlers
 *
 * Handles Discord gateway events for guild scheduled events:
 * - guildScheduledEventCreate: auto-create reminders
 * - guildScheduledEventUpdate: update reminders if time changed, handle completion
 * - guildScheduledEventDelete: clean up reminders
 * - guildScheduledEventUserAdd: RSVP tracking (logged)
 * - guildScheduledEventUserRemove: RSVP tracking (logged)
 */

import {
  type Client,
  EmbedBuilder,
  type GuildScheduledEvent,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  type PartialGuildScheduledEvent,
  type TextChannel,
  type User,
} from 'discord.js';
import { EventConfig } from '../typeorm/entities/event/EventConfig';
import { EventReminder } from '../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../typeorm/entities/event/EventTemplate';
import { enhancedLogger, LogCategory } from '../utils';
import { lazyRepo } from '../utils/database/lazyRepo';

const eventConfigRepo = lazyRepo(EventConfig);
const eventReminderRepo = lazyRepo(EventReminder);
const eventTemplateRepo = lazyRepo(EventTemplate);

// ============================================================================
// guildScheduledEventCreate
// ============================================================================

export const guildScheduledEventCreate = {
  name: 'guildScheduledEventCreate',
  async execute(event: GuildScheduledEvent, client: Client) {
    const guildId = event.guildId;
    if (!guildId) return;

    try {
      const config = await eventConfigRepo.findOneBy({ guildId });
      if (!config?.enabled) return;

      enhancedLogger.info(`Scheduled event created: ${event.name}`, LogCategory.SYSTEM, {
        guildId,
        eventId: event.id,
      });

      // Auto-create reminder if configured. Events the bot creates itself
      // (/event create, templates, recurring) already got one from that path.
      const createdByBot = !!event.creatorId && event.creatorId === client.user?.id;
      if (!createdByBot && config.reminderChannelId && config.defaultReminderMinutes > 0 && event.scheduledStartAt) {
        const reminderAt = new Date(event.scheduledStartAt.getTime() - config.defaultReminderMinutes * 60 * 1000);

        if (reminderAt > new Date()) {
          const reminder = eventReminderRepo.create({
            guildId,
            discordEventId: event.id,
            reminderAt,
            eventTitle: event.name,
          });
          await eventReminderRepo.save(reminder);

          enhancedLogger.info(`Auto-reminder created for event: ${event.name}`, LogCategory.SYSTEM, {
            guildId,
            eventId: event.id,
            reminderAt: reminderAt.toISOString(),
          });
        }
      }
    } catch (error) {
      enhancedLogger.error('Error handling scheduled event create', error as Error, LogCategory.ERROR, { guildId });
    }
  },
};

// ============================================================================
// guildScheduledEventUpdate
// ============================================================================

export const guildScheduledEventUpdate = {
  name: 'guildScheduledEventUpdate',
  async execute(
    oldEvent: GuildScheduledEvent | PartialGuildScheduledEvent | null,
    newEvent: GuildScheduledEvent,
    client: Client,
  ) {
    const guildId = newEvent.guildId;
    if (!guildId) return;

    try {
      const config = await eventConfigRepo.findOneBy({ guildId });
      if (!config?.enabled) return;

      enhancedLogger.info(`Scheduled event updated: ${newEvent.name}`, LogCategory.SYSTEM, {
        guildId,
        eventId: newEvent.id,
        status: newEvent.status,
      });

      // If the event has completed, handle post-event summary and recurring
      if (newEvent.status === GuildScheduledEventStatus.Completed) {
        await handleEventCompleted(newEvent, config, client);
        return;
      }

      // If start time changed, move the pending reminders with it
      if (
        oldEvent?.scheduledStartAt &&
        newEvent.scheduledStartAt &&
        oldEvent.scheduledStartAt.getTime() !== newEvent.scheduledStartAt.getTime()
      ) {
        // Shift every unsent reminder (the default and any /event remind ones)
        // by the same amount, and drop the ones that now fall in the past.
        const shift = newEvent.scheduledStartAt.getTime() - oldEvent.scheduledStartAt.getTime();
        const pending = await eventReminderRepo.find({ where: { guildId, discordEventId: newEvent.id, sent: false } });
        const kept: EventReminder[] = [];
        const expired: EventReminder[] = [];
        for (const reminder of pending) {
          reminder.reminderAt = new Date(reminder.reminderAt.getTime() + shift);
          (reminder.reminderAt > new Date() ? kept : expired).push(reminder);
        }
        if (expired.length > 0) await eventReminderRepo.remove(expired);
        if (kept.length > 0) await eventReminderRepo.save(kept);

        // Add the default reminder if the event had none (e.g. it was too close to start before).
        if (config.reminderChannelId && config.defaultReminderMinutes > 0) {
          const reminderAt = new Date(newEvent.scheduledStartAt.getTime() - config.defaultReminderMinutes * 60 * 1000);

          if (reminderAt > new Date() && !kept.some(r => r.reminderAt.getTime() === reminderAt.getTime())) {
            const reminder = eventReminderRepo.create({
              guildId,
              discordEventId: newEvent.id,
              reminderAt,
              eventTitle: newEvent.name,
            });
            await eventReminderRepo.save(reminder);
          }
        }
      }
    } catch (error) {
      enhancedLogger.error('Error handling scheduled event update', error as Error, LogCategory.ERROR, { guildId });
    }
  },
};

// ============================================================================
// guildScheduledEventDelete
// ============================================================================

export const guildScheduledEventDelete = {
  name: 'guildScheduledEventDelete',
  async execute(event: GuildScheduledEvent | PartialGuildScheduledEvent, _client: Client) {
    const guildId = event.guildId;
    if (!guildId) return;

    try {
      // Clean up all reminders for this event
      const result = await eventReminderRepo.delete({
        guildId,
        discordEventId: event.id,
      });

      if (result.affected && result.affected > 0) {
        enhancedLogger.info(`Reminders cleared for deleted event: ${event.id}`, LogCategory.SYSTEM, {
          guildId,
          eventId: event.id,
          remindersCleared: result.affected,
        });
      }
    } catch (error) {
      enhancedLogger.error('Error handling scheduled event delete', error as Error, LogCategory.ERROR, { guildId });
    }
  },
};

// ============================================================================
// guildScheduledEventUserAdd
// ============================================================================

export const guildScheduledEventUserAdd = {
  name: 'guildScheduledEventUserAdd',
  async execute(event: GuildScheduledEvent | PartialGuildScheduledEvent, user: User) {
    const guildId = event.guildId;
    if (!guildId) return;

    enhancedLogger.debug(`User ${user.id} subscribed to event ${event.id}`, LogCategory.SYSTEM, {
      guildId,
      eventId: event.id,
      userId: user.id,
    });
  },
};

// ============================================================================
// guildScheduledEventUserRemove
// ============================================================================

export const guildScheduledEventUserRemove = {
  name: 'guildScheduledEventUserRemove',
  async execute(event: GuildScheduledEvent | PartialGuildScheduledEvent, user: User) {
    const guildId = event.guildId;
    if (!guildId) return;

    enhancedLogger.debug(`User ${user.id} unsubscribed from event ${event.id}`, LogCategory.SYSTEM, {
      guildId,
      eventId: event.id,
      userId: user.id,
    });
  },
};

// ============================================================================
// Helpers
// ============================================================================

async function handleEventCompleted(event: GuildScheduledEvent, config: EventConfig, client: Client): Promise<void> {
  const guildId = event.guildId;

  // Clean up reminders
  await eventReminderRepo.delete({ guildId, discordEventId: event.id });

  // Post-event summary
  if (config.postEventSummary && config.summaryChannelId) {
    try {
      const channel = (await client.channels.fetch(config.summaryChannelId).catch(() => null)) as TextChannel | null;

      if (channel) {
        const subscriberCount = event.userCount ?? 0;

        const embed = new EmbedBuilder()
          .setTitle('Event Ended')
          .setDescription(
            subscriberCount > 0
              ? `**${event.name}** has ended. ${subscriberCount} users were interested.`
              : `**${event.name}** has ended.`,
          )
          .setColor(0x808080);

        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      enhancedLogger.error('Failed to send event summary', error as Error, LogCategory.ERROR, {
        guildId,
      });
    }
  }

  // Handle recurring: find template and create next occurrence
  await handleRecurringNext(event, config, client);
}

async function handleRecurringNext(event: GuildScheduledEvent, config: EventConfig, client: Client): Promise<void> {
  const guildId = event.guildId;

  // Recurring occurrences are created by the bot. An event someone made by
  // hand in Discord with the same title must not start a chain of its own.
  if (!event.creatorId || event.creatorId !== client.user?.id) return;

  // Try to find a recurring template matching this event title
  const templates = await eventTemplateRepo.find({
    where: { guildId, isRecurring: true },
  });

  const matchingTemplate = templates.find(t => t.title === event.name);
  if (!matchingTemplate?.recurringPattern) return;

  // Calculate next occurrence
  const lastStart = event.scheduledStartAt || new Date();
  const nextStart = calculateNextOccurrence(lastStart, matchingTemplate.recurringPattern);
  const nextEnd = new Date(nextStart.getTime() + matchingTemplate.defaultDurationMinutes * 60 * 1000);

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const entityTypeMap: Record<string, GuildScheduledEventEntityType> = {
      voice: GuildScheduledEventEntityType.Voice,
      stage: GuildScheduledEventEntityType.StageInstance,
      external: GuildScheduledEventEntityType.External,
    };

    const resolvedEntityType = entityTypeMap[matchingTemplate.entityType] || GuildScheduledEventEntityType.External;

    const eventData: Parameters<typeof guild.scheduledEvents.create>[0] = {
      name: matchingTemplate.title,
      scheduledStartTime: nextStart,
      scheduledEndTime: nextEnd,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: resolvedEntityType,
      description: matchingTemplate.description || undefined,
    };

    if (resolvedEntityType === GuildScheduledEventEntityType.External) {
      eventData.entityMetadata = {
        location: matchingTemplate.location || 'TBD',
      };
    } else if (event.channelId && event.entityType !== GuildScheduledEventEntityType.External) {
      // Voice and stage: the next occurrence uses the channel (and kind) of the one that just ended.
      eventData.entityType = event.entityType;
      eventData.channel = event.channelId;
    } else {
      enhancedLogger.warn(
        'Recurring voice/stage event has no channel; next occurrence not created',
        LogCategory.SYSTEM,
        {
          guildId,
          templateName: matchingTemplate.name,
        },
      );
      return;
    }

    const newEvent = await guild.scheduledEvents.create(eventData);

    // Create reminder for next occurrence
    if (config.reminderChannelId && config.defaultReminderMinutes > 0) {
      const reminderAt = new Date(nextStart.getTime() - config.defaultReminderMinutes * 60 * 1000);

      if (reminderAt > new Date()) {
        const reminder = eventReminderRepo.create({
          guildId,
          discordEventId: newEvent.id,
          reminderAt,
          eventTitle: matchingTemplate.title,
        });
        await eventReminderRepo.save(reminder);
      }
    }

    enhancedLogger.info(`Recurring event '${matchingTemplate.title}' next occurrence created`, LogCategory.SYSTEM, {
      guildId,
      nextStart: nextStart.toISOString(),
      pattern: matchingTemplate.recurringPattern,
    });
  } catch (error) {
    enhancedLogger.error('Failed to create recurring event occurrence', error as Error, LogCategory.ERROR, {
      guildId,
      templateName: matchingTemplate.name,
    });
  }
}

function calculateNextOccurrence(lastStart: Date, pattern: string): Date {
  const next = new Date(lastStart);

  switch (pattern) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      next.setDate(next.getDate() + 7); // Default to weekly
  }

  return next;
}
