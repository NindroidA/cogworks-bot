/**
 * Dev Test Command Handlers
 *
 * Testing utilities for new v3 features. Bot owner only.
 * These simulate conditions that are hard to test manually (reactions from
 * multiple users, time-based checks, member joins, etc.)
 */

import {
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { StarboardConfig } from '../../../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../../../typeorm/entities/starboard/StarboardEntry';
import { StatusIncident } from '../../../typeorm/entities/status/StatusIncident';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { XPConfig } from '../../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { enhancedLogger, LogCategory, requireBotOwner } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { checkAndSendReminders } from '../../../utils/event/reminderChecker';
import { sendOnboardingFlow } from '../../../utils/onboarding/onboardingEngine';
import { checkAndAlertSlaBreaches } from '../../../utils/ticket/slaChecker';
import { routeTicket } from '../../../utils/ticket/smartRouter';
import { calculateLevel, xpForNextLevel } from '../../../utils/xp/xpCalculator';

const xpUserRepo = lazyRepo(XPUser);
const xpConfigRepo = lazyRepo(XPConfig);
const starboardConfigRepo = lazyRepo(StarboardConfig);
const starboardEntryRepo = lazyRepo(StarboardEntry);
const ticketRepo = lazyRepo(Ticket);
const ticketConfigRepo = lazyRepo(TicketConfig);
const analyticsSnapshotRepo = lazyRepo(AnalyticsSnapshot);
const statusIncidentRepo = lazyRepo(StatusIncident);

export async function devTestHandler(
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // Bot owner only
  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message || '❌ Bot owner only.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'starboard-simulate':
        await handleStarboardSimulate(client, interaction, guildId);
        break;
      case 'xp-grant':
        await handleXpGrant(interaction, guildId);
        break;
      case 'xp-force-levelup':
        await handleXpForceLevelup(interaction, guildId);
        break;
      case 'xp-simulate-voice':
        await handleXpSimulateVoice(interaction, guildId);
        break;
      case 'sla-force-check':
        await handleSlaForceCheck(client, interaction);
        break;
      case 'sla-backdate-ticket':
        await handleSlaBackdateTicket(interaction, guildId);
        break;
      case 'onboarding-trigger':
        await handleOnboardingTrigger(interaction);
        break;
      case 'analytics-flush':
        await handleAnalyticsFlush(interaction, guildId);
        break;
      case 'analytics-seed':
        await handleAnalyticsSeed(interaction, guildId);
        break;
      case 'reminder-force-check':
        await handleReminderForceCheck(client, interaction);
        break;
      case 'routing-simulate':
        await handleRoutingSimulate(interaction, guildId);
        break;
      case 'import-seed-xp':
        await handleImportSeedXp(interaction, guildId);
        break;
      case 'status-create-incident':
        await handleStatusCreateIncident(interaction);
        break;
      case 'cleanup-test-data':
        await handleCleanupTestData(interaction, guildId);
        break;
      default:
        await interaction.reply({
          content: '❌ Unknown dev-test subcommand.',
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    enhancedLogger.error('Dev test command error', error as Error, LogCategory.COMMAND_EXECUTION);
    await interaction
      .reply({
        content: `❌ Error: ${(error as Error).message}`,
        flags: [MessageFlags.Ephemeral],
      })
      .catch(() => {});
  }
}

// ─── Starboard ──────────────────────────────────────────────────────────────

async function handleStarboardSimulate(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const messageId = interaction.options.getString('message-id', true);
  const count = interaction.options.getInteger('count') || 5;

  const config = await starboardConfigRepo.findOneBy({ guildId });
  if (!config?.enabled || !config.channelId) {
    await interaction.reply({
      content: '❌ Starboard not configured/enabled.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Fetch the original message
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({
      content: '❌ Run this in the channel containing the message.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    await interaction.reply({
      content: '❌ Message not found in this channel.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Create/update starboard entry
  let entry = await starboardEntryRepo.findOneBy({
    guildId,
    originalMessageId: messageId,
  });

  const fetchedChannel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!fetchedChannel || !fetchedChannel.isTextBased() || !('send' in fetchedChannel)) {
    await interaction.reply({
      content: '❌ Starboard channel not found.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  const starboardChannel = fetchedChannel as import('discord.js').TextChannel;

  const embed = new EmbedBuilder()
    .setAuthor({
      name: message.author.displayName,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(message.content || '*(no text content)*')
    .setColor(0xffd700)
    .setFooter({
      text: `${config.emoji} ${count} | #${'name' in channel ? channel.name : 'unknown'}`,
    })
    .setTimestamp(message.createdAt);

  if (message.attachments.size > 0) {
    const firstAttachment = message.attachments.first();
    if (firstAttachment?.contentType?.startsWith('image/')) {
      embed.setImage(firstAttachment.url);
    }
  }

  if (entry) {
    // Update existing
    entry.starCount = count;
    if (entry.starboardMessageId) {
      const starMsg = await starboardChannel.messages
        .fetch(entry.starboardMessageId)
        .catch(() => null);
      if (starMsg) {
        await starMsg.edit({ embeds: [embed] });
      }
    }
    await starboardEntryRepo.save(entry);
  } else {
    // Create new starboard post
    const starMsg = await starboardChannel.send({
      embeds: [embed],
    });

    entry = starboardEntryRepo.create({
      guildId,
      originalMessageId: messageId,
      originalChannelId: channel.id,
      authorId: message.author.id,
      starboardMessageId: starMsg.id,
      starCount: count,
      content: message.content?.substring(0, 4096) || null,
      attachmentUrl: message.attachments.first()?.url || null,
    });
    await starboardEntryRepo.save(entry);
  }

  await interaction.reply({
    content: `✅ Simulated **${count}** ${config.emoji} on message. Starboard entry created/updated.`,
    flags: [MessageFlags.Ephemeral],
  });
}

// ─── XP ─────────────────────────────────────────────────────────────────────

async function handleXpGrant(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  let xpUser = await xpUserRepo.findOneBy({ guildId, userId: user.id });
  if (!xpUser) {
    xpUser = xpUserRepo.create({
      guildId,
      userId: user.id,
      xp: 0,
      level: 0,
      messages: 0,
      voiceMinutes: 0,
    });
  }

  xpUser.xp += amount;
  xpUser.level = calculateLevel(xpUser.xp);
  await xpUserRepo.save(xpUser);

  await interaction.reply({
    content: `✅ Granted **${amount} XP** to ${user}. Total: **${xpUser.xp} XP** (Level ${xpUser.level})`,
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleXpForceLevelup(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const user = interaction.options.getUser('user', true);

  let xpUser = await xpUserRepo.findOneBy({ guildId, userId: user.id });
  if (!xpUser) {
    xpUser = xpUserRepo.create({
      guildId,
      userId: user.id,
      xp: 0,
      level: 0,
      messages: 0,
      voiceMinutes: 0,
    });
  }

  const nextLevel = xpUser.level + 1;
  const xpNeeded = xpForNextLevel(xpUser.level);
  xpUser.xp = xpNeeded;
  xpUser.level = nextLevel;
  await xpUserRepo.save(xpUser);

  // Check for role rewards
  const rewards = await AppDataSource.getRepository(XPRoleReward).find({
    where: { guildId, level: nextLevel },
  });

  const guild = interaction.guild;
  if (guild && rewards.length > 0) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) {
      for (const reward of rewards) {
        await member.roles.add(reward.roleId).catch(() => {});
      }
    }
  }

  await interaction.reply({
    content: `✅ Leveled up ${user} to **Level ${nextLevel}** (${xpNeeded} XP).${rewards.length > 0 ? ` Granted ${rewards.length} role reward(s).` : ''}`,
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleXpSimulateVoice(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const minutes = interaction.options.getInteger('minutes', true);

  const config = await xpConfigRepo.findOneBy({ guildId });
  const xpPerMinute = config?.xpPerVoiceMinute ?? 5;
  const totalXp = minutes * xpPerMinute;

  let xpUser = await xpUserRepo.findOneBy({ guildId, userId: user.id });
  if (!xpUser) {
    xpUser = xpUserRepo.create({
      guildId,
      userId: user.id,
      xp: 0,
      level: 0,
      messages: 0,
      voiceMinutes: 0,
    });
  }

  xpUser.voiceMinutes += minutes;
  xpUser.xp += totalXp;
  xpUser.level = calculateLevel(xpUser.xp);
  await xpUserRepo.save(xpUser);

  await interaction.reply({
    content: `✅ Simulated **${minutes} minutes** of voice for ${user}. +${totalXp} XP (${xpPerMinute}/min). Total: **${xpUser.xp} XP** (Level ${xpUser.level})`,
    flags: [MessageFlags.Ephemeral],
  });
}

// ─── SLA ────────────────────────────────────────────────────────────────────

async function handleSlaForceCheck(
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  await checkAndAlertSlaBreaches(client);
  await interaction.editReply(
    '✅ SLA breach check completed. Check the breach channel for any alerts.',
  );
}

async function handleSlaBackdateTicket(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const ticketId = interaction.options.getInteger('ticket-id', true);
  const minutesAgo = interaction.options.getInteger('minutes-ago', true);

  const ticket = await ticketRepo.findOneBy({ guildId, id: ticketId });
  if (!ticket) {
    await interaction.reply({
      content: `❌ Ticket #${ticketId} not found.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const backdatedTime = new Date(Date.now() - minutesAgo * 60 * 1000);
  await ticketRepo.update({ id: ticketId, guildId }, { lastActivityAt: backdatedTime });

  const config = await ticketConfigRepo.findOneBy({ guildId });
  const targetMinutes = config?.slaTargetMinutes ?? 60;

  await interaction.reply({
    content: `✅ Ticket #${ticketId} creation time backdated to **${minutesAgo} minutes ago**. SLA target is ${targetMinutes}min. ${minutesAgo >= targetMinutes ? '⚠️ This should trigger a breach on next check.' : 'Still within SLA.'}`,
    flags: [MessageFlags.Ephemeral],
  });
}

// ─── Onboarding ─────────────────────────────────────────────────────────────

async function handleOnboardingTrigger(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!member || !interaction.guild) {
    await interaction.reply({
      content: '❌ Must be used in a server.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const guildMember = await interaction.guild.members.fetch(interaction.user.id);
  const success = await sendOnboardingFlow(guildMember);

  if (success) {
    await interaction.editReply('✅ Onboarding flow sent to your DMs. Check your direct messages.');
  } else {
    await interaction.editReply(
      '❌ Onboarding failed. Either not configured, no steps, or DMs are closed.',
    );
  }
}

// ─── Analytics ──────────────────────────────────────────────────────────────

async function handleAnalyticsFlush(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  try {
    const { activityTracker } = await import('../../../utils/analytics/activityTracker');
    const memberCount = interaction.guild?.memberCount ?? 0;
    await activityTracker.flushSnapshot(guildId, memberCount);
    await interaction.editReply(
      '✅ Analytics counters flushed to snapshot. Check `/insights overview`.',
    );
  } catch (error) {
    await interaction.editReply(`❌ Flush failed: ${(error as Error).message}`);
  }
}

async function handleAnalyticsSeed(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const days = interaction.options.getInteger('days') || 30;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const snapshots: Partial<AnalyticsSnapshot>[] = [];
  const now = new Date();
  let baseMembers = Math.floor(Math.random() * 200) + 50;

  for (let i = days; i >= 1; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const joined = Math.floor(Math.random() * 8);
    const left = Math.floor(Math.random() * 3);
    baseMembers += joined - left;

    snapshots.push({
      guildId,
      date: new Date(dateStr),
      memberCount: Math.max(baseMembers, 1),
      memberJoined: joined,
      memberLeft: left,
      messageCount: Math.floor(Math.random() * 500) + 50,
      activeMembers: Math.floor(Math.random() * Math.min(baseMembers, 50)) + 5,
      voiceMinutes: Math.floor(Math.random() * 300),
      topChannels: [
        {
          channelId: '1',
          name: 'general',
          count: Math.floor(Math.random() * 200) + 20,
        },
        {
          channelId: '2',
          name: 'off-topic',
          count: Math.floor(Math.random() * 100) + 10,
        },
        {
          channelId: '3',
          name: 'help',
          count: Math.floor(Math.random() * 50) + 5,
        },
      ],
      peakHourUtc: Math.floor(Math.random() * 24),
    });
  }

  // Upsert — delete existing then insert
  await analyticsSnapshotRepo.delete({ guildId });
  await analyticsSnapshotRepo.save(snapshots as AnalyticsSnapshot[]);

  await interaction.editReply(
    `✅ Seeded **${days} days** of analytics data. Check \`/insights growth ${days}\`, \`/insights channels ${days}\`, \`/insights hours ${days}\`.`,
  );
}

// ─── Event Reminders ────────────────────────────────────────────────────────

async function handleReminderForceCheck(
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  await checkAndSendReminders(client);
  await interaction.editReply(
    '✅ Event reminder check completed. Check the reminder channel for any due reminders.',
  );
}

// ─── Smart Routing ──────────────────────────────────────────────────────────

async function handleRoutingSimulate(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const ticketType = interaction.options.getString('ticket-type', true);
  const guild = interaction.guild;
  if (!guild) return;

  const config = await ticketConfigRepo.findOneBy({ guildId });
  if (!config) {
    await interaction.reply({
      content: '❌ Ticket config not found.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const routingConfig = config as typeof config & {
    smartRoutingEnabled?: boolean;
    routingRules?: Array<{
      ticketTypeId: string;
      staffRoleId: string;
      maxOpen?: number;
    }>;
    routingStrategy?: string;
  };

  if (!routingConfig.smartRoutingEnabled || !routingConfig.routingRules) {
    await interaction.reply({
      content: '❌ Smart routing not enabled or no rules configured.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const result = await routeTicket(
    guild,
    ticketType,
    routingConfig.routingRules,
    (routingConfig.routingStrategy as 'least-load' | 'round-robin' | 'random') || 'least-load',
  );

  const embed = new EmbedBuilder()
    .setTitle('Routing Simulation')
    .setColor(result.member ? 0x00ff00 : 0xff0000)
    .addFields(
      { name: 'Ticket Type', value: ticketType, inline: true },
      {
        name: 'Strategy',
        value: routingConfig.routingStrategy || 'least-load',
        inline: true,
      },
      {
        name: 'Result',
        value: result.member
          ? `Would assign to **${result.member.displayName}**`
          : `No assignment: ${result.reason || 'unknown'}`,
      },
    );

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

// ─── Import/Seed XP ─────────────────────────────────────────────────────────

async function handleImportSeedXp(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const count = interaction.options.getInteger('count') || 10;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  // Get actual guild members to seed realistic data
  const guild = interaction.guild;
  if (!guild) return;

  const members = await guild.members.fetch({ limit: count + 1 });
  const nonBotMembers = members.filter(m => !m.user.bot).first(count);

  let seeded = 0;
  for (const member of nonBotMembers) {
    const xp = Math.floor(Math.random() * 50000) + 100;
    const level = calculateLevel(xp);

    let xpUser = await xpUserRepo.findOneBy({ guildId, userId: member.id });
    if (!xpUser) {
      xpUser = xpUserRepo.create({
        guildId,
        userId: member.id,
        xp,
        level,
        messages: Math.floor(Math.random() * 1000) + 10,
        voiceMinutes: Math.floor(Math.random() * 500),
      });
    } else {
      xpUser.xp = xp;
      xpUser.level = level;
      xpUser.messages = Math.floor(Math.random() * 1000) + 10;
      xpUser.voiceMinutes = Math.floor(Math.random() * 500);
    }
    await xpUserRepo.save(xpUser);
    seeded++;
  }

  await interaction.editReply(
    `✅ Seeded XP data for **${seeded}** members. Check \`/leaderboard\` and \`/rank\`.`,
  );
}

// ─── Status Incidents ───────────────────────────────────────────────────────

async function handleStatusCreateIncident(interaction: ChatInputCommandInteraction): Promise<void> {
  const level = interaction.options.getString('level', true);
  const message = interaction.options.getString('message', true);

  const incident = statusIncidentRepo.create({
    level: level as import('../../../typeorm/entities/status/StatusIncident').IncidentLevel,
    message,
    affectedSystems: ['test'],
  });
  await statusIncidentRepo.save(incident);

  await interaction.reply({
    content: `✅ Created test incident: **${level}** — "${message}". Check \`/status history\`.`,
    flags: [MessageFlags.Ephemeral],
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

async function handleCleanupTestData(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const results: string[] = [];

  // Clean seeded analytics
  const analyticsResult = await analyticsSnapshotRepo.delete({ guildId });
  results.push(`Analytics snapshots: ${analyticsResult.affected || 0} deleted`);

  // Clean test incidents
  const incidentResult = await statusIncidentRepo.delete({
    affectedSystems: ['test'] as any,
  });
  results.push(`Test incidents: ${incidentResult.affected || 0} deleted`);

  // Clean seeded XP data
  const xpResult = await xpUserRepo.delete({ guildId });
  results.push(`XP users: ${xpResult.affected || 0} deleted`);

  // Clean starboard test entries
  const starboardResult = await starboardEntryRepo.delete({ guildId });
  results.push(`Starboard entries: ${starboardResult.affected || 0} deleted`);

  await interaction.editReply(`✅ Cleanup complete:\n${results.map(r => `- ${r}`).join('\n')}`);
}
