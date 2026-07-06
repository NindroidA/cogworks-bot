/**
 * Event Remind Handler
 *
 * Sets a custom reminder for a scheduled event.
 */

import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { lang } from '../../../lang';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import { enhancedLogger, formatLang, guardFeatureAccess, LogCategory, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

// Locale-aware (Proxy fallback) — was a direct en JSON import that bypassed i18n.
const eventLang = lang.event;

const eventConfigRepo = lazyRepo(EventConfig);
const eventReminderRepo = lazyRepo(EventReminder);

const tl = eventLang.remind;

export async function handleRemind(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const guard = await guardFeatureAccess(interaction, 'events', 'manage');
  if (!guard.allowed) return;

  if (!interaction.guildId || !interaction.guild) return;
  const guildId = interaction.guildId;

  const config = await eventConfigRepo.findOneBy({ guildId });
  if (!config?.enabled) {
    await replyEphemeralError(interaction, eventLang.errors.notEnabled);
    return;
  }

  if (!config.reminderChannelId) {
    await replyEphemeralError(interaction, eventLang.setup.notConfigured);
    return;
  }

  const eventId = interaction.options.getString('event', true);
  const minutesBefore = interaction.options.getInteger('minutes', true);

  try {
    const scheduledEvent = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);

    if (!scheduledEvent) {
      await replyEphemeralError(interaction, tl.eventNotFound);
      return;
    }

    if (!scheduledEvent.scheduledStartAt || scheduledEvent.scheduledStartAt <= new Date()) {
      await replyEphemeralError(interaction, tl.alreadyPast);
      return;
    }

    const reminderAt = new Date(scheduledEvent.scheduledStartAt.getTime() - minutesBefore * 60 * 1000);

    if (reminderAt <= new Date()) {
      await replyEphemeralError(interaction, tl.alreadyPast);
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
      content: formatLang(tl.success, minutesBefore.toString(), scheduledEvent.name),
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
    await replyEphemeralError(interaction, tl.error);
  }
}
