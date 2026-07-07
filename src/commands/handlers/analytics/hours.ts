import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { MoreThanOrEqual } from 'typeorm';
import { lang } from '../../../lang';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { buildHoursEmbed } from '../../../utils/analytics/digestBuilder';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { enhancedLogger, LogCategory } from '../../../utils/monitoring/enhancedLogger';

const configRepo = lazyRepo(AnalyticsConfig);
const snapshotRepo = lazyRepo(AnalyticsSnapshot);

export async function hoursHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    const config = await configRepo.findOneBy({ guildId });
    if (!config?.enabled) {
      await interaction.reply({
        content: lang.analytics.errors.notEnabled,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const days = interaction.options.getInteger('days') ?? 7;
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);

    const snapshots = await snapshotRepo.find({
      where: {
        guildId,
        date: MoreThanOrEqual(startDate),
      },
      order: { date: 'ASC' },
    });

    const embed = buildHoursEmbed(snapshots, days);
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    enhancedLogger.error('Failed to fetch hourly analytics', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: lang.analytics.errors.fetchFailed,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
