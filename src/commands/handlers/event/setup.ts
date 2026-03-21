/**
 * Event Setup Handlers
 *
 * Handles: enable, disable, reminder-channel, summary-channel, default-reminder
 */

import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from 'discord.js';
import eventLang from '../../../lang/event.json';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import {
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const eventConfigRepo = lazyRepo(EventConfig);
const tl = eventLang.setup;

export const eventSetupHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const subcommand = interaction.options.getSubcommand();

  // Rate limit check
  const rateLimitKey = createRateLimitKey.guild(guildId, 'event-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    let config = await eventConfigRepo.findOneBy({ guildId });

    switch (subcommand) {
      case 'enable': {
        if (config?.enabled) {
          await interaction.reply({
            content: tl.alreadyEnabled,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
        if (!config) {
          config = eventConfigRepo.create({ guildId, enabled: true });
        } else {
          config.enabled = true;
        }
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: tl.enableSuccess,
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event system enabled', interaction.user.id, guildId);
        break;
      }

      case 'disable': {
        if (!config?.enabled) {
          await interaction.reply({
            content: tl.alreadyDisabled,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
        config.enabled = false;
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: tl.disableSuccess,
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event system disabled', interaction.user.id, guildId);
        break;
      }

      case 'reminder-channel': {
        if (!config) {
          await interaction.reply({
            content: tl.notConfigured,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
        const channel = interaction.options.getChannel('channel', true);
        config.reminderChannelId = channel.id;
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: LANGF(tl.reminderChannelSet, `<#${channel.id}>`),
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event reminder channel set', interaction.user.id, guildId);
        break;
      }

      case 'summary-channel': {
        if (!config) {
          await interaction.reply({
            content: tl.notConfigured,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
        const channel = interaction.options.getChannel('channel', true);
        config.summaryChannelId = channel.id;
        config.postEventSummary = true;
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: LANGF(tl.summaryChannelSet, `<#${channel.id}>`),
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event summary channel set', interaction.user.id, guildId);
        break;
      }

      case 'default-reminder': {
        if (!config) {
          await interaction.reply({
            content: tl.notConfigured,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }
        const minutes = interaction.options.getInteger('minutes', true);
        config.defaultReminderMinutes = minutes;
        await eventConfigRepo.save(config);
        await interaction.reply({
          content: LANGF(tl.defaultReminderSet, minutes.toString()),
          flags: [MessageFlags.Ephemeral],
        });
        enhancedLogger.command('Event default reminder set', interaction.user.id, guildId);
        break;
      }

      default: {
        await interaction.reply({
          content: lang.errors.unknownSubcommand,
          flags: [MessageFlags.Ephemeral],
        });
      }
    }
  } catch (error) {
    enhancedLogger.error('Event setup failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: tl.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
