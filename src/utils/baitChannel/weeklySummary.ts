/**
 * Weekly Summary Digest for Bait Channel System
 *
 * Generates and sends a weekly summary of bait channel activity
 * to guilds that have opted in via enableWeeklySummary.
 *
 * Called hourly from index.ts; fires on Sunday 00:xx UTC.
 */

import { type Client, EmbedBuilder, type TextChannel } from 'discord.js';
import { MoreThan } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../../typeorm/entities/bait/BaitChannelLog';
import { Colors } from '../colors';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

const FLAG_LABELS: Record<string, string> = {
  newAccount: 'New Account',
  newMember: 'New Member',
  noMessages: 'No Messages',
  noVerification: 'No Verification',
  suspiciousContent: 'Suspicious Content',
  linkSpam: 'Link Spam',
  mentionSpam: 'Mention Spam',
  defaultAvatar: 'Default Avatar',
  emptyProfile: 'Empty Profile',
  suspiciousUsername: 'Suspicious Username',
  noRoles: 'No Roles',
  discordInvite: 'Discord Invite',
  phishingUrl: 'Phishing URL',
  attachmentOnly: 'Attachment Only',
  joinBurst: 'Join Burst',
};

/**
 * Check all guilds with enableWeeklySummary and send the digest
 * if the current UTC hour is Sunday 00:xx.
 */
export async function checkAndSendWeeklySummaries(client: Client): Promise<void> {
  const now = new Date();

  // Only fire on Sunday (day 0) at the 00:xx UTC hour
  if (now.getUTCDay() !== 0 || now.getUTCHours() !== 0) return;

  try {
    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const configs = await configRepo.find({
      where: { enableWeeklySummary: true },
    });

    if (configs.length === 0) return;

    enhancedLogger.info(`Sending weekly bait channel summaries to ${configs.length} guild(s)`, LogCategory.SYSTEM);

    const results = await Promise.allSettled(configs.map(config => sendGuildSummary(client, config)));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        enhancedLogger.error(
          `Failed to send weekly summary for guild ${configs[i].guildId}`,
          (results[i] as PromiseRejectedResult).reason as Error,
          LogCategory.ERROR,
        );
      }
    }
  } catch (error) {
    enhancedLogger.error('Failed to check weekly summaries', error as Error, LogCategory.ERROR);
  }
}

async function sendGuildSummary(client: Client, config: BaitChannelConfig): Promise<void> {
  // Determine target channel: summaryChannelId override, then logChannelId fallback
  const targetChannelId = config.summaryChannelId || config.logChannelId;
  if (!targetChannelId) return;

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;

  const channel = (await guild.channels.fetch(targetChannelId).catch(() => null)) as TextChannel | null;
  if (!channel) return;

  // Fetch logs from the past 7 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const logRepo = AppDataSource.getRepository(BaitChannelLog);
  const logs = await logRepo.find({
    where: {
      guildId: config.guildId,
      createdAt: MoreThan(cutoff),
    },
  });

  // Build and send embed
  const embed = logs.length === 0 ? buildZeroActivityEmbed() : buildSummaryEmbed(logs);
  await channel.send({ embeds: [embed] });

  enhancedLogger.info(`Weekly summary sent for guild ${config.guildId}`, LogCategory.SYSTEM, {
    guildId: config.guildId,
    channelId: targetChannelId,
    logCount: logs.length,
  });
}

function buildZeroActivityEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Weekly Bait Channel Summary')
    .setDescription('No bait channel activity in the past 7 days.')
    .setColor(Colors.status.success);
}

function buildSummaryEmbed(logs: BaitChannelLog[]): EmbedBuilder {
  const total = logs.length;

  // Action breakdown
  const actionCounts: Record<string, number> = {};
  let overriddenCount = 0;
  let totalScore = 0;

  for (const log of logs) {
    const action = log.actionTaken || 'unknown';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
    totalScore += log.suspicionScore || 0;
    if (log.overridden) overriddenCount++;
  }

  const avgScore = Math.round(totalScore / total);

  // Override rate
  // Only count actionable entries (not whitelisted/deleted-in-time) as the denominator
  const actionableLogs = logs.filter(l => l.actionTaken !== 'whitelisted' && l.actionTaken !== 'deleted-in-time');
  const overrideRate = actionableLogs.length > 0 ? Math.round((overriddenCount / actionableLogs.length) * 100) : 0;

  // Top 3 detection flags
  const flagCounts: Record<string, number> = {};
  for (const log of logs) {
    if (!log.detectionFlags) continue;
    for (const [key, triggered] of Object.entries(log.detectionFlags)) {
      if (triggered) {
        flagCounts[key] = (flagCounts[key] || 0) + 1;
      }
    }
  }
  const topFlags = Object.entries(flagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => `${FLAG_LABELS[key] || key}: ${count}`)
    .join('\n');

  // Action breakdown string
  const actionLines = Object.entries(actionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `${capitalize(action)}: ${count}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Weekly Bait Channel Summary')
    .setDescription(`Activity summary for the past 7 days.`)
    .setColor(Colors.status.info)
    .addFields(
      { name: 'Total Triggers', value: `${total}`, inline: true },
      { name: 'Avg Suspicion Score', value: `${avgScore}/100`, inline: true },
      { name: 'Override Rate', value: `${overrideRate}%`, inline: true },
      { name: 'Action Breakdown', value: actionLines || 'None', inline: false },
    );

  if (topFlags) {
    embed.addFields({
      name: 'Top Detection Flags',
      value: topFlags,
      inline: false,
    });
  }

  // Threshold suggestion
  if (overrideRate > 20) {
    embed.addFields({
      name: 'Suggestion',
      value:
        'Your override rate is above 20%. Consider raising the instant action threshold or enabling escalation mode to reduce false positives.',
      inline: false,
    });
  }

  return embed;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
