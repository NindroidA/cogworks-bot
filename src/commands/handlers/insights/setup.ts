import { type CacheType, type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { formatLang, lang } from '../../../utils';
import { Colors } from '../../../utils/colors';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { guardFeatureAccess } from '../../../utils/interactions/guardHelper';
import { enhancedLogger, LogCategory } from '../../../utils/monitoring/enhancedLogger';

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
      content: lang.analytics.setup.alreadyEnabled,
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
    content: lang.analytics.setup.enabled,
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
      content: lang.analytics.setup.alreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  config.enabled = false;
  await configRepo.save(config);

  await interaction.reply({
    content: lang.analytics.setup.disabled,
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
      content: formatLang(lang.analytics.setup.channelSet, `<#${channel.id}>`),
      flags: [MessageFlags.Ephemeral],
    });
  } else {
    config.digestChannelId = null;
    await configRepo.save(config);
    await interaction.reply({
      content: lang.analytics.setup.channelCleared,
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
      content: lang.analytics.setup.specifyFrequency,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!['weekly', 'monthly', 'both'].includes(frequency)) {
    await interaction.reply({
      content: lang.analytics.setup.invalidFrequency,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (day !== null) {
    if (frequency === 'weekly' && (day < 0 || day > 6)) {
      await interaction.reply({
        content: lang.analytics.setup.invalidDayWeekly,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    if (frequency === 'monthly' && (day < 1 || day > 28)) {
      await interaction.reply({
        content: lang.analytics.setup.invalidDayMonthly,
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
    content: formatLang(lang.analytics.setup.frequencySet, frequency, dayLabel),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command('Analytics digest frequency updated', interaction.user.id, guildId);
}

/** Handle the "status" action: show current analytics configuration. */
async function handleStatusAction(interaction: ChatInputCommandInteraction<CacheType>, config: AnalyticsConfig | null) {
  const embed = new EmbedBuilder().setTitle(lang.analytics.setup.statusTitle).setColor(Colors.brand.primary);
  if (!config) {
    embed.setDescription(lang.analytics.setup.notConfigured);
    embed.addFields({
      name: lang.analytics.setup.statusField,
      value: lang.analytics.setup.statusDisabled,
      inline: true,
    });
  } else {
    const dayLabel = formatDayLabel(config.digestFrequency, config.digestDay);

    embed.addFields(
      {
        name: lang.analytics.setup.statusField,
        value: config.enabled ? lang.analytics.setup.statusEnabled : lang.analytics.setup.statusDisabled,
        inline: true,
      },
      {
        name: lang.analytics.setup.digestChannelField,
        value: config.digestChannelId ? `<#${config.digestChannelId}>` : lang.analytics.setup.notSet,
        inline: true,
      },
      { name: lang.analytics.setup.frequencyField, value: config.digestFrequency, inline: true },
      { name: lang.analytics.setup.digestDayField, value: dayLabel, inline: true },
    );
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

export async function insightsSetupHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guard = await guardFeatureAccess(interaction, 'analytics', 'manage');
  if (!guard.allowed) return;

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
      content: lang.analytics.setup.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
