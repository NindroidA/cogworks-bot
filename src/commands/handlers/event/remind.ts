/**
 * Event Remind Handler
 *
 * Sets a custom reminder for a scheduled event.
 */

import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from 'discord.js';
import eventLang from '../../../lang/event.json';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import { enhancedLogger, LANGF, LogCategory, requireAdmin } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const eventConfigRepo = lazyRepo(EventConfig);
const eventReminderRepo = lazyRepo(EventReminder);

const tl = eventLang.remind;

export async function handleRemind(
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
      content: eventLang.errors.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!config.reminderChannelId) {
    await interaction.reply({
      content: eventLang.setup.notConfigured,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const eventId = interaction.options.getString('event', true);
  const minutesBefore = interaction.options.getInteger('minutes', true);

  try {
    const scheduledEvent = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);

    if (!scheduledEvent) {
      await interaction.reply({
        content: tl.eventNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!scheduledEvent.scheduledStartAt || scheduledEvent.scheduledStartAt <= new Date()) {
      await interaction.reply({
        content: tl.alreadyPast,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const reminderAt = new Date(
      scheduledEvent.scheduledStartAt.getTime() - minutesBefore * 60 * 1000,
    );

    if (reminderAt <= new Date()) {
      await interaction.reply({
        content: tl.alreadyPast,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const reminder = eventReminderRepo.create({
      guildId,
      discordEventId: eventId,
      reminderAt,
      eventTitle: scheduledEvent.name,
    });

    await eventReminderRepo.save(reminder);

    await interaction.reply({
      content: LANGF(tl.success, minutesBefore.toString(), scheduledEvent.name),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command(
      `Reminder set for event '${scheduledEvent.name}' (${minutesBefore}min before)`,
      interaction.user.id,
      guildId,
    );
  } catch (error) {
    enhancedLogger.error('Event remind failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: tl.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
