import {
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { MoreThan } from 'typeorm';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelLog } from '../../../typeorm/entities/BaitChannelLog';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';

const tl = lang.baitChannel;

export const statsHandler = async (_client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const days = interaction.options.getInteger('days') || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const logRepo = AppDataSource.getRepository(BaitChannelLog);
    const logs = await safeDbOperation(
      () =>
        logRepo.find({
          where: {
            guildId: interaction.guildId!,
            createdAt: MoreThan(cutoff),
          },
          order: { createdAt: 'DESC' },
        }),
      'Fetch bait channel logs',
    );

    const recentLogs = logs || [];

    const stats = {
      total: recentLogs.length,
      banned: recentLogs.filter(l => l.actionTaken === 'banned').length,
      kicked: recentLogs.filter(l => l.actionTaken === 'kicked').length,
      timedOut: recentLogs.filter(l => l.actionTaken === 'timed-out').length,
      deleted: recentLogs.filter(l => l.actionTaken === 'deleted-in-time').length,
      whitelisted: recentLogs.filter(l => l.actionTaken === 'whitelisted').length,
      loggedOnly: recentLogs.filter(l => l.actionTaken === 'logged').length,
      overridden: recentLogs.filter(l => l.overridden).length,
      avgScore:
        recentLogs.length > 0
          ? (recentLogs.reduce((sum, l) => sum + l.suspicionScore, 0) / recentLogs.length).toFixed(
              1,
            )
          : '0',
    };

    // Override rate calculation
    const actionableLogs = recentLogs.filter(l => l.actionTaken !== 'logged');
    const overrideRate =
      actionableLogs.length > 0
        ? ((stats.overridden / actionableLogs.length) * 100).toFixed(1)
        : '0.0';

    // Score distribution buckets
    const scoreDist = {
      low: recentLogs.filter(l => l.suspicionScore < 30).length,
      medium: recentLogs.filter(l => l.suspicionScore >= 30 && l.suspicionScore < 60).length,
      high: recentLogs.filter(l => l.suspicionScore >= 60 && l.suspicionScore < 90).length,
      critical: recentLogs.filter(l => l.suspicionScore >= 90).length,
    };

    // Top 5 detection flags
    const flagCounts: Record<string, number> = {};
    for (const log of recentLogs) {
      if (!log.detectionFlags) continue;
      for (const [flag, triggered] of Object.entries(log.detectionFlags)) {
        if (triggered) {
          flagCounts[flag] = (flagCounts[flag] || 0) + 1;
        }
      }
    }
    const topFlags = Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([flag, count]) => `\`${flag}\`: ${count}`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle(tl.stats.title)
      .setDescription(tl.stats.description.replace('{0}', days.toString()))
      .addFields(
        { name: tl.stats.totalTriggers, value: `${stats.total}`, inline: true },
        { name: tl.stats.banned, value: `${stats.banned}`, inline: true },
        { name: tl.stats.kicked, value: `${stats.kicked}`, inline: true },
        { name: tl.stats.timedOut, value: `${stats.timedOut}`, inline: true },
        {
          name: tl.stats.deletedInTime,
          value: `${stats.deleted}`,
          inline: true,
        },
        {
          name: tl.stats.whitelisted,
          value: `${stats.whitelisted}`,
          inline: true,
        },
        {
          name: tl.stats.loggedOnly,
          value: `${stats.loggedOnly}`,
          inline: true,
        },
        {
          name: tl.stats.overridden,
          value: `${stats.overridden}`,
          inline: true,
        },
        {
          name: tl.stats.avgSuspicion,
          value: `${stats.avgScore}/100`,
          inline: true,
        },
        {
          name: tl.stats.overrideRate,
          value: `${overrideRate}%`,
          inline: true,
        },
        {
          name: tl.stats.scoreDistribution,
          value: `0-29: ${scoreDist.low} | 30-59: ${scoreDist.medium} | 60-89: ${scoreDist.high} | 90-100: ${scoreDist.critical}`,
          inline: false,
        },
      )
      .setTimestamp();

    if (topFlags) {
      embed.addFields({
        name: tl.stats.topFlags,
        value: topFlags,
        inline: false,
      });
    }

    if (recentLogs.length > 0) {
      const topOffenders = recentLogs
        .slice(0, 5)
        .map((log, i) => `${i + 1}. ${log.username} (Score: ${log.suspicionScore})`)
        .join('\n');

      embed.addFields({
        name: tl.stats.recentDetections,
        value: topOffenders || tl.stats.none,
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.fetchStats);
  }
};
