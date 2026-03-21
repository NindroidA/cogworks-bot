/**
 * Event Reminder Checker
 *
 * Periodically checks for unsent reminders whose time has arrived
 * and posts them to the configured reminder channel.
 * Called by a periodic interval (every hour), same pattern as ticket autoClose.
 */

import { type Client, EmbedBuilder, type TextChannel, TimestampStyles, time } from 'discord.js';
import { LessThanOrEqual } from 'typeorm';
import { EventConfig } from '../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../typeorm/entities/event/EventReminder';
import { lazyRepo } from '../database/lazyRepo';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

const eventConfigRepo = lazyRepo(EventConfig);
const eventReminderRepo = lazyRepo(EventReminder);

/**
 * Check all pending reminders and send notifications.
 * Called by a periodic interval (every hour).
 */
export async function checkAndSendReminders(client: Client): Promise<void> {
  try {
    const now = new Date();

    // Find all unsent reminders whose time has arrived
    const pendingReminders = await eventReminderRepo.find({
      where: {
        sent: false,
        reminderAt: LessThanOrEqual(now),
      },
    });

    if (pendingReminders.length === 0) return;

    // Group by guild for efficient config lookups
    const byGuild = new Map<string, EventReminder[]>();
    for (const reminder of pendingReminders) {
      const existing = byGuild.get(reminder.guildId) || [];
      existing.push(reminder);
      byGuild.set(reminder.guildId, existing);
    }

    for (const [guildId, reminders] of byGuild) {
      try {
        await processGuildReminders(client, guildId, reminders);
      } catch (error) {
        enhancedLogger.error(
          `Reminder check failed for guild ${guildId}`,
          error as Error,
          LogCategory.ERROR,
          { guildId },
        );
      }
    }
  } catch (error) {
    enhancedLogger.error('Reminder check failed', error as Error, LogCategory.ERROR);
  }
}

async function processGuildReminders(
  client: Client,
  guildId: string,
  reminders: EventReminder[],
): Promise<void> {
  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled || !config.reminderChannelId) {
    // No config or no reminder channel — mark as sent to avoid re-processing
    for (const reminder of reminders) {
      reminder.sent = true;
    }
    await eventReminderRepo.save(reminders);
    return;
  }

  const channel = (await client.channels
    .fetch(config.reminderChannelId)
    .catch(() => null)) as TextChannel | null;

  if (!channel) {
    enhancedLogger.warn('Reminder channel not found', LogCategory.SYSTEM, {
      guildId,
      channelId: config.reminderChannelId,
    });
    // Mark as sent to avoid retrying endlessly
    for (const reminder of reminders) {
      reminder.sent = true;
    }
    await eventReminderRepo.save(reminders);
    return;
  }

  for (const reminder of reminders) {
    try {
      // Try to fetch the actual event from Discord to get current info
      const guild = client.guilds.cache.get(guildId);
      const scheduledEvent = guild
        ? await guild.scheduledEvents.fetch(reminder.discordEventId).catch(() => null)
        : null;

      const eventTitle = scheduledEvent?.name || reminder.eventTitle || 'Unknown Event';
      const startTimestamp = scheduledEvent?.scheduledStartAt
        ? time(scheduledEvent.scheduledStartAt, TimestampStyles.RelativeTime)
        : 'soon';

      const embed = new EmbedBuilder()
        .setTitle('Event Reminder')
        .setDescription(`**${eventTitle}** starts ${startTimestamp}!`)
        .setColor(0x5865f2)
        .setTimestamp();

      if (scheduledEvent?.description) {
        embed.addFields({ name: 'Description', value: scheduledEvent.description.slice(0, 1024) });
      }

      await channel.send({ embeds: [embed] });

      reminder.sent = true;
      await eventReminderRepo.save(reminder);

      enhancedLogger.info('Reminder sent for event', LogCategory.SYSTEM, {
        guildId,
        eventId: reminder.discordEventId,
        eventTitle,
      });
    } catch (error) {
      enhancedLogger.error(
        `Failed to send reminder for event ${reminder.discordEventId}`,
        error as Error,
        LogCategory.ERROR,
        { guildId, reminderId: reminder.id },
      );
      // Mark as sent to avoid infinite retries
      reminder.sent = true;
      await eventReminderRepo.save(reminder);
    }
  }
}
