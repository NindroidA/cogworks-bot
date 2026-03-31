import { type CacheType, type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { Colors } from '../../../utils/colors';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { enhancedLogger, LogCategory } from '../../../utils/monitoring/enhancedLogger';
import { requireAdmin } from '../../../utils/validation/permissionValidator';

const configRepo = lazyRepo(AnalyticsConfig);

/** Format a digest day number into a human-readable label. */
function formatDayLabel(frequency: string, day: number): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return frequency === 'monthly' ? `${day}${getOrdinalSuffix(day)} of month` : (dayNames[day] ?? `day ${day}`);
}

/** Handle the "enable" action: turn on analytics for the guild. */
async function handleEnableAction(
  interaction: ChatInputCommandInteraction<CacheType>,
  config: AnalyticsConfig | null,
  guildId: string,
) {
  if (config?.enabled) {
    await interaction.reply({
      content: 'Analytics are already enabled.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!config) {
    config = configRepo.create({ guildId, enabled: true });
  } else {
    config.enabled = true;
  }
  await configRepo.save(config);

  await interaction.reply({
    content: 'Analytics have been **enabled** for this server. Data collection will begin now.',
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command('Analytics enabled', interaction.user.id, guildId);
}

/** Handle the "disable" action: turn off analytics for the guild. */
async function handleDisableAction(
  interaction: ChatInputCommandInteraction<CacheType>,
  config: AnalyticsConfig | null,
  guildId: string,
) {
  if (!config?.enabled) {
    await interaction.reply({
      content: 'Analytics are already disabled.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.enabled = false;
  await configRepo.save(config);

  await interaction.reply({
    content: 'Analytics have been **disabled**. Existing data is preserved.',
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command('Analytics disabled', interaction.user.id, guildId);
}

/** Handle the "channel" action: set or clear the digest channel. */
async function handleChannelAction(
  interaction: ChatInputCommandInteraction<CacheType>,
  config: AnalyticsConfig | null,
  guildId: string,
) {
  const channel = interaction.options.getChannel('channel');

  if (!config) {
    config = configRepo.create({ guildId, enabled: false });
  }

  if (channel) {
    config.digestChannelId = channel.id;
    await configRepo.save(config);
    await interaction.reply({
      content: `Digest channel set to <#${channel.id}>.`,
      flags: [MessageFlags.Ephemeral],
    });
  } else {
    config.digestChannelId = null;
    await configRepo.save(config);
    await interaction.reply({
      content: 'Digest channel has been cleared. No digests will be sent.',
      flags: [MessageFlags.Ephemeral],
    });
  }

  enhancedLogger.command('Analytics digest channel updated', interaction.user.id, guildId);
}

/** Handle the "frequency" action: set digest frequency and day. */
async function handleFrequencyAction(
  interaction: ChatInputCommandInteraction<CacheType>,
  config: AnalyticsConfig | null,
  guildId: string,
) {
  const frequency = interaction.options.getString('frequency');
  const day = interaction.options.getInteger('day');

  if (!frequency) {
    await interaction.reply({
      content: 'Please specify a frequency using the `frequency` option.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!['weekly', 'monthly', 'both'].includes(frequency)) {
    await interaction.reply({
      content: 'Invalid frequency. Choose `weekly`, `monthly`, or `both`.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (day !== null) {
    if (frequency === 'weekly' && (day < 0 || day > 6)) {
      await interaction.reply({
        content: 'Invalid day value. Use 0-6 for weekly (Sun-Sat).',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    if (frequency === 'monthly' && (day < 1 || day > 28)) {
      await interaction.reply({
        content: 'Invalid day value. Use 1-28 for monthly.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  }

  if (!config) {
    config = configRepo.create({ guildId, enabled: false });
  }

  config.digestFrequency = frequency;
  if (day !== null) {
    config.digestDay = day;
  }
  await configRepo.save(config);

  const dayLabel = formatDayLabel(frequency, config.digestDay);

  await interaction.reply({
    content: `Digest frequency set to **${frequency}** (day: ${dayLabel}).`,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command('Analytics digest frequency updated', interaction.user.id, guildId);
}

/** Handle the "status" action: show current analytics configuration. */
async function handleStatusAction(interaction: ChatInputCommandInteraction<CacheType>, config: AnalyticsConfig | null) {
  const embed = new EmbedBuilder().setTitle('Analytics Configuration').setColor(Colors.brand.primary);
  if (!config) {
    embed.setDescription('Analytics have not been configured for this server.');
    embed.addFields({ name: 'Status', value: 'Disabled', inline: true });
  } else {
    const dayLabel = formatDayLabel(config.digestFrequency, config.digestDay);

    embed.addFields(
      {
        name: 'Status',
        value: config.enabled ? 'Enabled' : 'Disabled',
        inline: true,
      },
      {
        name: 'Digest Channel',
        value: config.digestChannelId ? `<#${config.digestChannelId}>` : 'Not set',
        inline: true,
      },
      { name: 'Frequency', value: config.digestFrequency, inline: true },
      { name: 'Digest Day', value: dayLabel, inline: true },
    );
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

export async function insightsSetupHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  // Require admin permissions for setup
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  const action = interaction.options.getString('action', true);

  try {
    const config = await configRepo.findOneBy({ guildId });

    switch (action) {
      case 'enable':
        await handleEnableAction(interaction, config, guildId);
        break;
      case 'disable':
        await handleDisableAction(interaction, config, guildId);
        break;
      case 'channel':
        await handleChannelAction(interaction, config, guildId);
        break;
      case 'frequency':
        await handleFrequencyAction(interaction, config, guildId);
        break;
      case 'status':
        await handleStatusAction(interaction, config);
        break;
    }
  } catch (error) {
    enhancedLogger.error('Analytics setup failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
      action,
    });
    await interaction.reply({
      content: 'Failed to update analytics configuration.',
      flags: [MessageFlags.Ephemeral],
    });
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
