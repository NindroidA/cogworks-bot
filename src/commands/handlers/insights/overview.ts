import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { buildOverviewEmbed } from '../../../utils/analytics/digestBuilder';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { enhancedLogger, LogCategory } from '../../../utils/monitoring/enhancedLogger';

const configRepo = lazyRepo(AnalyticsConfig);
const snapshotRepo = lazyRepo(AnalyticsSnapshot);

export const overviewHandler = async (_client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    // Check if analytics is enabled
    const config = await configRepo.findOneBy({ guildId });
    if (!config?.enabled) {
      await interaction.reply({
        content: 'Analytics are not enabled for this server. An admin can enable them with `/insights setup`.',
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
      content: 'Failed to fetch analytics data.',
      flags: [MessageFlags.Ephemeral],
    });
  }
};
