import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { lang } from '../../../lang';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { buildOverviewEmbed } from '../../../utils/analytics/digestBuilder';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { enhancedLogger, LogCategory } from '../../../utils/monitoring/enhancedLogger';

const configRepo = lazyRepo(AnalyticsConfig);
const snapshotRepo = lazyRepo(AnalyticsSnapshot);

export async function overviewHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    // Check if analytics is enabled
    const config = await configRepo.findOneBy({ guildId });
    if (!config?.enabled) {
      await interaction.reply({
        content: lang.analytics.errors.notEnabled,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Get today's snapshot
    const today = new Date().toISOString().slice(0, 10);
    const snapshot = await snapshotRepo.findOneBy({
      guildId,
      date: new Date(today),
    });

    const guildName = interaction.guild?.name ?? 'Server';
    const embed = buildOverviewEmbed(snapshot, guildName);

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    enhancedLogger.error('Failed to fetch analytics overview', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await interaction.reply({
      content: lang.analytics.errors.fetchFailed,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
