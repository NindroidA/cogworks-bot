/**
 * Event Setup Handlers
 *
 * Handles: enable, disable, reminder-channel, summary-channel, default-reminder
 */

import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import {
  createToggleHandler,
  enhancedLogger,
  formatLang,
  guardFeatureRateLimit,
  LogCategory,
  lang,
  RateLimits,
  replyEphemeralError,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

// Locale-aware (Proxy fallback) — was a direct en JSON import that bypassed i18n.
const eventLang = lang.event;

const eventConfigRepo = lazyRepo(EventConfig);
const tl = eventLang.setup;

const eventToggle = createToggleHandler({
  repo: eventConfigRepo,
  field: 'enabled',
  messages: {
    alreadyEnabled: tl.alreadyEnabled,
    alreadyDisabled: tl.alreadyDisabled,
    enabled: tl.enableSuccess,
    disabled: tl.disableSuccess,
  },
  onToggled: (interaction, guildId, enabled) =>
    enhancedLogger.command(`Event system ${enabled ? 'enabled' : 'disabled'}`, interaction.user.id, guildId),
});

export async function eventSetupHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureRateLimit(interaction, 'events', 'manage', {
    action: 'event-setup',
    limit: RateLimits.ANNOUNCEMENT_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const subcommand = interaction.options.getSubcommand();

  try {
    const config = await eventConfigRepo.findOneBy({ guildId });

    switch (subcommand) {
      case 'enable': {
        await eventToggle.enable(interaction, guildId);
        break;
      }

      case 'disable': {
        await eventToggle.disable(interaction, guildId);
        break;
      }

      case 'reminder-channel': {
        if (!config) {
          await replyEphemeralError(interaction, tl.notConfigured);
          return;
        }
        const channel = interaction.options.getChannel('channel', true);
        config.reminderChannelId = channel.id;
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: formatLang(tl.reminderChannelSet, `<#${channel.id}>`),
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event reminder channel set', interaction.user.id, guildId);
        break;
      }

      case 'summary-channel': {
        if (!config) {
          await replyEphemeralError(interaction, tl.notConfigured);
          return;
        }
        const channel = interaction.options.getChannel('channel', true);
        config.summaryChannelId = channel.id;
        config.postEventSummary = true;
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: formatLang(tl.summaryChannelSet, `<#${channel.id}>`),
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event summary channel set', interaction.user.id, guildId);
        break;
      }

      case 'default-reminder': {
        if (!config) {
          await replyEphemeralError(interaction, tl.notConfigured);
          return;
        }
        const minutes = interaction.options.getInteger('minutes', true);
        config.defaultReminderMinutes = minutes;
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: formatLang(tl.defaultReminderSet, minutes.toString()),
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event default reminder set', interaction.user.id, guildId);
        break;
      }

      default: {
        await replyEphemeralError(interaction, lang.errors.unknownSubcommand);
      }
    }
  } catch (error) {
    enhancedLogger.error('Event setup failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await replyEphemeralError(interaction, tl.error);
  }
}
