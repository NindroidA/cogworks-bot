/**
 * Digest Builder — Builds weekly/monthly digest embeds.
 *
 * Features:
 * - Text sparkline for message trend
 * - Top 5 channels
 * - Member growth rate
 * - Peak hours display
 */

import { type Client, EmbedBuilder, type TextChannel } from 'discord.js';
import { Between } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import type { AnalyticsConfig } from '../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../typeorm/entities/analytics/AnalyticsSnapshot';
import { Colors } from '../colors';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

/**
 * Sparkline characters — maps a 0-1 fraction to a bar character.
 */
const SPARK_CHARS = [
  '\u2581',
  '\u2582',
  '\u2583',
  '\u2584',
  '\u2585',
  '\u2586',
  '\u2587',
  '\u2588',
];

/**
 * Convert an array of numbers to a text sparkline string.
 */
function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  if (max === 0) return SPARK_CHARS[0].repeat(values.length);

  return values
    .map(v => {
      const index = Math.min(
        Math.floor((v / max) * (SPARK_CHARS.length - 1)),
        SPARK_CHARS.length - 1,
      );
      return SPARK_CHARS[index];
    })
    .join('');
}

/**
 * Format a number with locale-aware separators.
 */
function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Format hour as a readable string (e.g., "3 PM UTC").
 */
function formatHour(hour: number): string {
  if (hour === 0) return '12 AM UTC';
  if (hour === 12) return '12 PM UTC';
  return hour < 12 ? `${hour} AM UTC` : `${hour - 12} PM UTC`;
}

/**
 * Build a digest embed from snapshot data for a given date range.
 */
function buildDigestEmbed(
  snapshots: AnalyticsSnapshot[],
  title: string,
  periodLabel: string,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(Colors.brand.primary).setTimestamp();

  if (snapshots.length === 0) {
    embed.setDescription('No data available for this period.');
    return embed;
  }

  // Message trend sparkline
  const messageCounts = snapshots.map(s => s.messageCount);
  const totalMessages = messageCounts.reduce((a, b) => a + b, 0);
  const spark = sparkline(messageCounts);

  embed.addFields({
    name: 'Message Trend',
    value: `\`${spark}\`\nTotal: **${fmt(totalMessages)}** messages`,
    inline: false,
  });

  // Top channels (aggregate across period)
  const channelAgg = new Map<string, { name: string; count: number }>();
  for (const snap of snapshots) {
    if (!snap.topChannels) continue;
    for (const ch of snap.topChannels) {
      const existing = channelAgg.get(ch.channelId);
      if (existing) {
        existing.count += ch.count;
      } else {
        channelAgg.set(ch.channelId, { name: ch.name, count: ch.count });
      }
    }
  }

  const topChannels = [...channelAgg.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  if (topChannels.length > 0) {
    const channelLines = topChannels.map(
      (ch, i) => `${i + 1}. **#${ch.name}** — ${fmt(ch.count)} msgs`,
    );
    embed.addFields({
      name: 'Top Channels',
      value: channelLines.join('\n'),
      inline: true,
    });
  }

  // Member growth
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const totalJoined = snapshots.reduce((a, s) => a + s.memberJoined, 0);
  const totalLeft = snapshots.reduce((a, s) => a + s.memberLeft, 0);
  const netGrowth = totalJoined - totalLeft;
  const growthSign = netGrowth >= 0 ? '+' : '';

  embed.addFields({
    name: 'Member Growth',
    value: [
      `Current: **${fmt(last.memberCount)}**`,
      `Joined: **${fmt(totalJoined)}** | Left: **${fmt(totalLeft)}**`,
      `Net: **${growthSign}${fmt(netGrowth)}**`,
    ].join('\n'),
    inline: true,
  });

  // Peak hours (aggregate hour counts)
  const hourAgg = new Map<number, number>();
  for (const snap of snapshots) {
    if (snap.peakHourUtc !== null) {
      // Weight each snapshot's peak hour by its message count
      hourAgg.set(snap.peakHourUtc, (hourAgg.get(snap.peakHourUtc) ?? 0) + snap.messageCount);
    }
  }

  if (hourAgg.size > 0) {
    const topHours = [...hourAgg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => formatHour(hour));

    embed.addFields({
      name: 'Peak Hours',
      value: topHours.join(', '),
      inline: true,
    });
  }

  // Active members average
  const activeCounts = snapshots.filter(s => s.activeMembers > 0).map(s => s.activeMembers);
  if (activeCounts.length > 0) {
    const avgActive = Math.round(activeCounts.reduce((a, b) => a + b, 0) / activeCounts.length);
    embed.addFields({
      name: 'Avg Daily Active',
      value: `**${fmt(avgActive)}** members`,
      inline: true,
    });
  }

  // Voice minutes
  const totalVoice = snapshots.reduce((a, s) => a + s.voiceMinutes, 0);
  if (totalVoice > 0) {
    const hours = Math.floor(totalVoice / 60);
    const mins = totalVoice % 60;
    embed.addFields({
      name: 'Voice Activity',
      value: `**${hours}h ${mins}m** total`,
      inline: true,
    });
  }

  embed.setFooter({ text: `Cogworks Analytics | ${periodLabel}` });

  return embed;
}

/**
 * Determine if a digest should be sent today for the given config.
 */
function shouldSendDigest(config: AnalyticsConfig, today: Date): 'weekly' | 'monthly' | null {
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday
  const dayOfMonth = today.getUTCDate(); // 1-31

  if (config.digestFrequency === 'weekly' || config.digestFrequency === 'both') {
    if (dayOfWeek === config.digestDay) return 'weekly';
  }

  if (config.digestFrequency === 'monthly' || config.digestFrequency === 'both') {
    if (dayOfMonth === config.digestDay) return 'monthly';
  }

  return null;
}

/**
 * Send a digest embed to the configured channel if it's the right day.
 */
export async function sendDigest(
  client: Client,
  config: AnalyticsConfig,
  today: Date,
): Promise<void> {
  const digestType = shouldSendDigest(config, today);
  if (!digestType) return;

  if (!config.digestChannelId) return;

  const channel = client.channels.cache.get(config.digestChannelId) as TextChannel | undefined;
  if (!channel?.isTextBased()) return;

  const snapshotRepo = AppDataSource.getRepository(AnalyticsSnapshot);
  const days = digestType === 'weekly' ? 7 : 30;
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - days);

  const snapshots = await snapshotRepo.find({
    where: {
      guildId: config.guildId,
      date: Between(startDate, today),
    },
    order: { date: 'ASC' },
  });

  const title = digestType === 'weekly' ? 'Weekly Server Digest' : 'Monthly Server Digest';
  const periodLabel = digestType === 'weekly' ? 'Last 7 days' : 'Last 30 days';

  const embed = buildDigestEmbed(snapshots, title, periodLabel);

  try {
    await channel.send({ embeds: [embed] });
    enhancedLogger.info(`Sent ${digestType} analytics digest`, LogCategory.SYSTEM, {
      guildId: config.guildId,
    });
  } catch (error) {
    enhancedLogger.error(
      'Failed to send analytics digest to channel',
      error as Error,
      LogCategory.SYSTEM,
      { guildId: config.guildId, channelId: config.digestChannelId },
    );
  }
}

/**
 * Build an overview embed for the current day (used by /insights overview).
 */
export function buildOverviewEmbed(
  snapshot: AnalyticsSnapshot | null,
  guildName: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Server Overview — Today`)
    .setColor(Colors.brand.primary)
    .setTimestamp();

  if (!snapshot) {
    embed.setDescription(
      'No activity data recorded yet. Analytics will start collecting once enabled.',
    );
    return embed;
  }

  embed.addFields(
    { name: 'Messages', value: `**${fmt(snapshot.messageCount)}**`, inline: true },
    { name: 'Active Members', value: `**${fmt(snapshot.activeMembers)}**`, inline: true },
    { name: 'Total Members', value: `**${fmt(snapshot.memberCount)}**`, inline: true },
    { name: 'Joins', value: `**${fmt(snapshot.memberJoined)}**`, inline: true },
    { name: 'Leaves', value: `**${fmt(snapshot.memberLeft)}**`, inline: true },
    {
      name: 'Voice Minutes',
      value: `**${fmt(snapshot.voiceMinutes)}**`,
      inline: true,
    },
  );

  if (snapshot.peakHourUtc !== null) {
    embed.addFields({
      name: 'Peak Hour',
      value: formatHour(snapshot.peakHourUtc),
      inline: true,
    });
  }

  if (snapshot.topChannels && snapshot.topChannels.length > 0) {
    const lines = snapshot.topChannels
      .slice(0, 5)
      .map((ch, i) => `${i + 1}. **#${ch.name}** — ${fmt(ch.count)}`);
    embed.addFields({
      name: 'Top Channels',
      value: lines.join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Cogworks Analytics' });

  return embed;
}

/**
 * Build a growth embed from snapshot data (used by /insights growth).
 */
export function buildGrowthEmbed(snapshots: AnalyticsSnapshot[], days: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Member Growth — Last ${days} Days`)
    .setColor(Colors.brand.primary)
    .setTimestamp();

  if (snapshots.length === 0) {
    embed.setDescription(
      'Not enough data to show growth trends. Check back after a few days of tracking.',
    );
    return embed;
  }

  const memberCounts = snapshots.map(s => s.memberCount);
  const spark = sparkline(memberCounts);
  const last = snapshots[snapshots.length - 1];
  const totalJoined = snapshots.reduce((a, s) => a + s.memberJoined, 0);
  const totalLeft = snapshots.reduce((a, s) => a + s.memberLeft, 0);
  const netGrowth = totalJoined - totalLeft;
  const growthSign = netGrowth >= 0 ? '+' : '';
  const avgDaily = snapshots.length > 0 ? (netGrowth / snapshots.length).toFixed(1) : '0';

  embed.setDescription(`\`${spark}\``);
  embed.addFields(
    { name: 'Current Members', value: `**${fmt(last.memberCount)}**`, inline: true },
    { name: 'Net Growth', value: `**${growthSign}${fmt(netGrowth)}**`, inline: true },
    { name: 'Avg Daily', value: `**${growthSign}${avgDaily}**/day`, inline: true },
    { name: 'Joined', value: `**${fmt(totalJoined)}**`, inline: true },
    { name: 'Left', value: `**${fmt(totalLeft)}**`, inline: true },
  );

  embed.setFooter({ text: 'Cogworks Analytics' });

  return embed;
}

/**
 * Build a channels embed from snapshot data (used by /insights channels).
 */
export function buildChannelsEmbed(snapshots: AnalyticsSnapshot[], days: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Top Channels — Last ${days} Days`)
    .setColor(Colors.brand.primary)
    .setTimestamp();

  if (snapshots.length === 0) {
    embed.setDescription('No channel activity data available for this period.');
    return embed;
  }

  // Aggregate channel counts
  const channelAgg = new Map<string, { name: string; count: number }>();
  for (const snap of snapshots) {
    if (!snap.topChannels) continue;
    for (const ch of snap.topChannels) {
      const existing = channelAgg.get(ch.channelId);
      if (existing) {
        existing.count += ch.count;
      } else {
        channelAgg.set(ch.channelId, { name: ch.name, count: ch.count });
      }
    }
  }

  const topChannels = [...channelAgg.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  if (topChannels.length === 0) {
    embed.setDescription('No channel activity data available for this period.');
    return embed;
  }

  const totalMessages = snapshots.reduce((a, s) => a + s.messageCount, 0);

  // Build bar chart
  const maxCount = topChannels[0].count;
  const lines = topChannels.map((ch, i) => {
    const barLen = Math.max(1, Math.round((ch.count / maxCount) * 10));
    const bar = '\u2588'.repeat(barLen);
    const pct = totalMessages > 0 ? ((ch.count / totalMessages) * 100).toFixed(1) : '0.0';
    return `${i + 1}. **#${ch.name}**\n${bar} ${fmt(ch.count)} (${pct}%)`;
  });

  embed.setDescription(lines.join('\n\n'));
  embed.addFields({
    name: 'Total Messages',
    value: `**${fmt(totalMessages)}**`,
    inline: true,
  });
  embed.setFooter({ text: 'Cogworks Analytics' });

  return embed;
}

/**
 * Build an hours heatmap embed from snapshot data (used by /insights hours).
 */
export function buildHoursEmbed(snapshots: AnalyticsSnapshot[], days: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Activity by Hour — Last ${days} Days`)
    .setColor(Colors.brand.primary)
    .setTimestamp();

  if (snapshots.length === 0) {
    embed.setDescription('No hourly activity data available for this period.');
    return embed;
  }

  // Count how often each hour was the peak
  const hourWeights = new Map<number, number>();
  for (const snap of snapshots) {
    if (snap.peakHourUtc !== null) {
      hourWeights.set(
        snap.peakHourUtc,
        (hourWeights.get(snap.peakHourUtc) ?? 0) + snap.messageCount,
      );
    }
  }

  if (hourWeights.size === 0) {
    embed.setDescription('No hourly activity data available for this period.');
    return embed;
  }

  // Build 24-hour bar visualization
  const maxWeight = Math.max(...hourWeights.values());
  const hourBars: string[] = [];

  for (let h = 0; h < 24; h++) {
    const weight = hourWeights.get(h) ?? 0;
    const barLen = maxWeight > 0 ? Math.round((weight / maxWeight) * 8) : 0;
    const bar = barLen > 0 ? SPARK_CHARS[Math.min(barLen, SPARK_CHARS.length - 1)] : '\u2581';
    hourBars.push(bar);
  }

  const peakHour = [...hourWeights.entries()].sort((a, b) => b[1] - a[1])[0];

  embed.setDescription(
    [
      'Message activity distribution across hours of the day (UTC)',
      '',
      `\`${hourBars.join('')}\``,
      '`0  3  6  9  12 15 18 21 `',
    ].join('\n'),
  );

  if (peakHour) {
    embed.addFields({
      name: 'Peak Hour',
      value: formatHour(peakHour[0]),
      inline: true,
    });
  }

  embed.setFooter({ text: 'Cogworks Analytics' });

  return embed;
}
