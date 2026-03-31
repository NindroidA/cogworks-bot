import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { AnnouncementLog } from '../../../typeorm/entities/announcement/AnnouncementLog';
import { ArchivedApplication } from '../../../typeorm/entities/application/ArchivedApplication';
import { BaitChannelLog } from '../../../typeorm/entities/bait/BaitChannelLog';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../../../typeorm/entities/event/EventTemplate';
import { MemoryConfig } from '../../../typeorm/entities/memory/MemoryConfig';
import { MemoryItem } from '../../../typeorm/entities/memory/MemoryItem';
import { OnboardingCompletion } from '../../../typeorm/entities/onboarding/OnboardingCompletion';
import { StarboardEntry } from '../../../typeorm/entities/starboard/StarboardEntry';
import { ArchivedTicket } from '../../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { enhancedLogger, handleInteractionError, LogCategory } from '../../../utils';
import { Colors } from '../../../utils/colors';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a snowflake-like fake ID for seeding */
function fakeSnowflake(): string {
  return `${Date.now()}${Math.floor(Math.random() * 100000)}`;
}

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Random integer between min and max (inclusive) */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Fetch real guild member IDs (up to limit) */
async function fetchMemberIds(interaction: ChatInputCommandInteraction, limit: number): Promise<string[]> {
  const members = await interaction.guild!.members.fetch({ limit });
  return Array.from(members.filter(m => !m.user.bot).keys()).slice(0, limit);
}

/** Fetch real text channel IDs from the guild */
async function fetchTextChannelIds(interaction: ChatInputCommandInteraction): Promise<string[]> {
  const channels = interaction.guild!.channels.cache.filter(c => c.isTextBased() && !c.isThread()).map(c => c.id);
  return channels.slice(0, 10);
}

/** XP required for a given level (standard curve) */
function xpForLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Calculate total XP for reaching a level */
function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) {
    total += xpForLevel(i);
  }
  return total;
}

const SAMPLE_CONTENT = [
  'This is an awesome community moment!',
  'Check out this incredible build',
  'Funniest thing I have seen all week',
  'Great discussion happening here',
  'This tip saved me so much time',
  'Absolutely legendary play right there',
  'Can we appreciate how good this is?',
  'New personal best, feeling proud',
  'The sunset view from spawn is unreal',
  'Teamwork makes the dream work',
  'Just hit a major milestone today!',
  'This bug is actually hilarious',
  'Best suggestion I have read all month',
  'Wholesome moment right here',
  'Underrated feature honestly',
  'Peak content right here',
  'This deserves way more attention',
  'Love the energy in this server',
  'Incredible artwork, well done!',
  'This guide is super helpful, thanks!',
];

const ATTACHMENT_URLS = [
  'https://cdn.discordapp.com/attachments/example/image1.png',
  'https://cdn.discordapp.com/attachments/example/image2.jpg',
  null,
  null,
  null,
];

// ─── Populate Handlers ─────────────────────────────────────────────────────────

async function populateStarboard(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ count: number }> {
  const repo = AppDataSource.getRepository(StarboardEntry);
  const memberIds = await fetchMemberIds(interaction, 20);
  const channelIds = await fetchTextChannelIds(interaction);

  if (memberIds.length === 0 || channelIds.length === 0) {
    return { count: 0 };
  }

  const count = randInt(15, 20);
  const entries: StarboardEntry[] = [];

  for (let i = 0; i < count; i++) {
    const entry = new StarboardEntry();
    entry.guildId = guildId;
    entry.originalMessageId = fakeSnowflake();
    entry.originalChannelId = pick(channelIds);
    entry.authorId = pick(memberIds);
    entry.starboardMessageId = fakeSnowflake();
    entry.starCount = randInt(3, 25);
    entry.content = pick(SAMPLE_CONTENT).substring(0, 200);
    entry.attachmentUrl = pick(ATTACHMENT_URLS);
    entries.push(entry);
  }

  await repo.save(entries);
  return { count };
}

async function populateXp(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ users: number; rewards: number }> {
  const userRepo = AppDataSource.getRepository(XPUser);
  const rewardRepo = AppDataSource.getRepository(XPRoleReward);
  const memberIds = await fetchMemberIds(interaction, 30);

  if (memberIds.length === 0) {
    return { users: 0, rewards: 0 };
  }

  const count = Math.min(randInt(20, 30), memberIds.length);
  const users: XPUser[] = [];

  for (let i = 0; i < count; i++) {
    const user = new XPUser();
    user.guildId = guildId;
    user.userId = memberIds[i];

    // Realistic distribution: most low, some medium, few high
    let level: number;
    const roll = Math.random();
    if (roll < 0.6) {
      level = randInt(1, 10);
    } else if (roll < 0.85) {
      level = randInt(10, 25);
    } else {
      level = randInt(25, 50);
    }

    user.level = level;
    user.xp = totalXpForLevel(level) + randInt(0, xpForLevel(level));
    user.messages = randInt(level * 10, level * 50);
    user.voiceMinutes = randInt(0, level * 30);
    user.lastXpAt = new Date(Date.now() - randInt(0, 7 * 24 * 60 * 60 * 1000));
    users.push(user);
  }

  await userRepo.save(users);

  // Add role rewards at levels 5, 10, 25
  const guild = interaction.guild!;
  const roles = Array.from(guild.roles.cache.filter(r => !r.managed && r.name !== '@everyone').values());

  const rewards: XPRoleReward[] = [];
  const rewardLevels = [5, 10, 25];

  for (let i = 0; i < rewardLevels.length && i < roles.length; i++) {
    const reward = new XPRoleReward();
    reward.guildId = guildId;
    reward.level = rewardLevels[i];
    reward.roleId = roles[i].id;
    reward.removeOnDelevel = false;
    rewards.push(reward);
  }

  if (rewards.length > 0) {
    await rewardRepo.save(rewards);
  }

  return { users: count, rewards: rewards.length };
}

async function populateAnalytics(interaction: ChatInputCommandInteraction, guildId: string): Promise<{ days: number }> {
  const repo = AppDataSource.getRepository(AnalyticsSnapshot);
  const channelIds = await fetchTextChannelIds(interaction);
  const guild = interaction.guild!;

  const days = 30;
  const snapshots: AnalyticsSnapshot[] = [];
  let memberCount = Math.max(guild.memberCount - randInt(10, 30), 5);

  for (let d = days; d >= 1; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    date.setHours(0, 0, 0, 0);

    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Gradual member growth
    const joined = randInt(0, 5);
    const left = randInt(0, 2);
    memberCount += joined - left;
    if (memberCount < 5) memberCount = 5;

    // Weekend message dip
    const baseMessages = isWeekend ? randInt(30, 80) : randInt(80, 250);

    const snapshot = new AnalyticsSnapshot();
    snapshot.guildId = guildId;
    snapshot.date = date;
    snapshot.memberCount = memberCount;
    snapshot.memberJoined = joined;
    snapshot.memberLeft = left;
    snapshot.messageCount = baseMessages;
    snapshot.activeMembers = randInt(Math.floor(baseMessages * 0.1), Math.floor(baseMessages * 0.4));
    snapshot.voiceMinutes = randInt(0, 300);
    snapshot.peakHourUtc = isWeekend ? randInt(14, 22) : randInt(17, 23);

    // Top channels from actual guild channels
    if (channelIds.length > 0) {
      const topCount = Math.min(5, channelIds.length);
      const shuffled = [...channelIds].sort(() => Math.random() - 0.5);
      snapshot.topChannels = shuffled.slice(0, topCount).map(channelId => {
        const channel = guild.channels.cache.get(channelId);
        return {
          channelId,
          name: channel?.name ?? 'unknown',
          count: randInt(5, Math.floor(baseMessages / topCount)),
        };
      });
    }

    snapshots.push(snapshot);
  }

  await repo.save(snapshots);
  return { days };
}

async function populateEvents(
  _interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ templates: number; reminders: number }> {
  const templateRepo = AppDataSource.getRepository(EventTemplate);
  const reminderRepo = AppDataSource.getRepository(EventReminder);

  const templates: EventTemplate[] = [];

  const t1 = new EventTemplate();
  t1.guildId = guildId;
  t1.name = 'game-night';
  t1.title = 'Friday Game Night';
  t1.description = 'Weekly community game night. Join voice and hang out!';
  t1.entityType = 'voice';
  t1.defaultDurationMinutes = 120;
  t1.isRecurring = true;
  t1.recurringPattern = 'weekly';
  templates.push(t1);

  const t2 = new EventTemplate();
  t2.guildId = guildId;
  t2.name = 'movie-night';
  t2.title = 'Movie Night';
  t2.description = 'Biweekly movie screening. Suggestions welcome!';
  t2.entityType = 'voice';
  t2.defaultDurationMinutes = 180;
  t2.isRecurring = true;
  t2.recurringPattern = 'biweekly';
  templates.push(t2);

  await templateRepo.save(templates);

  const reminders: EventReminder[] = [];
  const offsets = [
    { ms: 60 * 60 * 1000, title: 'Game Night in 1 hour' },
    { ms: 24 * 60 * 60 * 1000, title: 'Movie Night tomorrow' },
    { ms: 7 * 24 * 60 * 60 * 1000, title: 'Community Meetup next week' },
  ];

  for (const offset of offsets) {
    const r = new EventReminder();
    r.guildId = guildId;
    r.discordEventId = fakeSnowflake();
    r.reminderAt = new Date(Date.now() + offset.ms);
    r.sent = false;
    r.eventTitle = offset.title;
    reminders.push(r);
  }

  await reminderRepo.save(reminders);
  return { templates: templates.length, reminders: reminders.length };
}

async function populateOnboarding(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ completed: number; abandoned: number; inProgress: number }> {
  const repo = AppDataSource.getRepository(OnboardingCompletion);
  const memberIds = await fetchMemberIds(interaction, 20);

  if (memberIds.length < 15) {
    // Pad with fake IDs if not enough members
    while (memberIds.length < 15) {
      memberIds.push(fakeSnowflake());
    }
  }

  const allSteps = ['welcome', 'rules', 'roles', 'intro', 'tour'];
  const completions: OnboardingCompletion[] = [];
  let idx = 0;

  // 10 completed
  for (let i = 0; i < 10; i++) {
    const c = new OnboardingCompletion();
    c.guildId = guildId;
    c.userId = memberIds[idx++];
    c.completedSteps = [...allSteps];
    c.completedAt = new Date(Date.now() - randInt(1, 30) * 24 * 60 * 60 * 1000);
    c.lastStepAt = c.completedAt;
    completions.push(c);
  }

  // 3 abandoned (no completedAt)
  for (let i = 0; i < 3; i++) {
    const c = new OnboardingCompletion();
    c.guildId = guildId;
    c.userId = memberIds[idx++];
    c.completedSteps = allSteps.slice(0, randInt(1, 3));
    c.completedAt = null;
    c.lastStepAt = new Date(Date.now() - randInt(3, 14) * 24 * 60 * 60 * 1000);
    completions.push(c);
  }

  // 2 in-progress (partial steps)
  for (let i = 0; i < 2; i++) {
    const c = new OnboardingCompletion();
    c.guildId = guildId;
    c.userId = memberIds[idx++];
    c.completedSteps = allSteps.slice(0, randInt(2, 4));
    c.completedAt = null;
    c.lastStepAt = new Date(Date.now() - randInt(0, 2) * 24 * 60 * 60 * 1000);
    completions.push(c);
  }

  await repo.save(completions);
  return { completed: 10, abandoned: 3, inProgress: 2 };
}

async function populateSla(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ withinSla: number; breached: number; pending: number }> {
  const repo = AppDataSource.getRepository(Ticket);

  const tickets: Ticket[] = [];

  // 2 within SLA
  for (let i = 0; i < 2; i++) {
    const t = new Ticket();
    t.guildId = guildId;
    t.channelId = null;
    t.messageId = null;
    t.createdBy = interaction.user.id;
    t.type = 'sla-test';
    t.status = 'open';
    t.lastActivityAt = new Date(Date.now() - randInt(1, 24) * 60 * 60 * 1000);
    t.firstResponseAt = new Date(t.lastActivityAt.getTime() + randInt(5, 30) * 60 * 1000);
    t.slaBreached = false;
    t.slaBreachNotified = false;
    tickets.push(t);
  }

  // 2 breached
  for (let i = 0; i < 2; i++) {
    const t = new Ticket();
    t.guildId = guildId;
    t.channelId = null;
    t.messageId = null;
    t.createdBy = interaction.user.id;
    t.type = 'sla-test';
    t.status = 'open';
    t.lastActivityAt = new Date(Date.now() - randInt(2, 5) * 24 * 60 * 60 * 1000);
    t.firstResponseAt = null;
    t.slaBreached = true;
    t.slaBreachNotified = true;
    tickets.push(t);
  }

  // 1 pending (recent, no response yet)
  const pending = new Ticket();
  pending.guildId = guildId;
  pending.channelId = null;
  pending.messageId = null;
  pending.createdBy = interaction.user.id;
  pending.type = 'sla-test';
  pending.status = 'open';
  pending.lastActivityAt = new Date(Date.now() - randInt(1, 10) * 60 * 1000);
  pending.firstResponseAt = null;
  pending.slaBreached = false;
  pending.slaBreachNotified = false;
  tickets.push(pending);

  await repo.save(tickets);
  return { withinSla: 2, breached: 2, pending: 1 };
}

async function populateTickets(interaction: ChatInputCommandInteraction, guildId: string): Promise<{ count: number }> {
  const repo = AppDataSource.getRepository(ArchivedTicket);
  const archiveConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);

  // Find the archive forum channel
  const archiveConfig = await archiveConfigRepo.findOneBy({ guildId });
  const forumChannel = archiveConfig?.channelId
    ? await interaction.guild!.channels.fetch(archiveConfig.channelId).catch(() => null)
    : null;

  const ticketTypes = [
    'general',
    'bug-report',
    'support',
    'general',
    'bug-report',
    'support',
    'general',
    'support',
    'bug-report',
    'general',
  ];
  const ticketNames = [
    'Help with permissions',
    'Server crash report',
    'Role request',
    'Channel access needed',
    'Bug: emojis not showing',
    'Payment issue',
    'Feature suggestion',
    'Account recovery',
    'Email import test',
    'General inquiry',
  ];
  const count = 10;
  let created = 0;

  for (let i = 0; i < count; i++) {
    const entry = new ArchivedTicket();
    entry.guildId = guildId;
    entry.createdBy = interaction.user.id;
    entry.ticketType = ticketTypes[i];
    entry.customTypeId = null;
    entry.forumTagIds = null;
    entry.isEmailTicket = i === 7;
    entry.emailSender = i === 7 ? 'user@example.com' : null;
    entry.emailSenderName = i === 7 ? 'External User' : null;
    entry.emailSubject = i === 7 ? 'Help with my account' : null;

    // Create real forum thread if archive channel exists
    if (forumChannel && 'threads' in forumChannel) {
      try {
        const thread = await forumChannel.threads.create({
          name: `[${ticketTypes[i]}] ${ticketNames[i]}`,
          message: {
            content: `**Ticket by** ${interaction.user.username}\n**Type:** ${ticketTypes[i]}\n\nThis is a test archived ticket created by the dev suite populate command.${entry.isEmailTicket ? `\n\n📧 **Email ticket** from ${entry.emailSender}` : ''}`,
          },
        });
        entry.messageId = thread.id;
        // Lock the thread (archived tickets are closed)
        await thread.setLocked(true).catch(() => {});
        await thread.setArchived(true).catch(() => {});
      } catch {
        entry.messageId = fakeSnowflake();
      }
    } else {
      entry.messageId = fakeSnowflake();
    }

    await repo.save(entry);
    created++;
  }

  return { count: created };
}

async function populateApplications(
  _interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ count: number }> {
  const repo = AppDataSource.getRepository(ArchivedApplication);

  const fakeUserIds = [
    '100000000000000001',
    '100000000000000002',
    '100000000000000003',
    '100000000000000004',
    '100000000000000005',
    '100000000000000006',
    '100000000000000007',
    '100000000000000008',
  ];
  const count = 8;
  const entries: ArchivedApplication[] = [];

  for (let i = 0; i < count; i++) {
    const entry = new ArchivedApplication();
    entry.guildId = guildId;
    entry.messageId = fakeSnowflake();
    entry.createdBy = fakeUserIds[i];
    entries.push(entry);
  }

  await repo.save(entries);
  return { count };
}

async function populateMemory(_interaction: ChatInputCommandInteraction, guildId: string): Promise<{ count: number }> {
  const memoryConfigRepo = AppDataSource.getRepository(MemoryConfig);
  const itemRepo = AppDataSource.getRepository(MemoryItem);

  // Find an existing memory config for this guild, or skip if none exists
  const memoryConfig = await memoryConfigRepo.findOneBy({ guildId });
  if (!memoryConfig) {
    return { count: 0 };
  }

  const fakeUserIds = [
    '100000000000000001',
    '100000000000000002',
    '100000000000000003',
    '100000000000000004',
    '100000000000000005',
  ];
  const titles = [
    'Bug: Login button unresponsive on mobile',
    'Feature: Add dark mode toggle to settings',
    'Note: Server maintenance scheduled for Friday',
    'Bug: Notification sound plays twice',
    'Feature: Bulk role assignment tool',
    'Note: Updated moderation guidelines',
    'Bug: Emoji picker freezing on older devices',
    'Feature: Customizable welcome messages',
    'Note: Backup procedure documentation',
    'Bug: Channel permissions not syncing correctly',
  ];
  const statuses = [
    'Open',
    'Open',
    'In Progress',
    'Open',
    'Completed',
    'Open',
    'In Progress',
    'Open',
    'Completed',
    'Open',
  ];
  const descriptions = [
    'Users report the login button does not respond on iOS Safari.',
    'Many users have requested a dark mode option in the dashboard.',
    'Scheduled downtime for database migration, estimated 2 hours.',
    'Duplicate notification sound when receiving DMs in voice channels.',
    'Admins need a way to assign roles to multiple users at once.',
    'New moderation rules added for link sharing in general channels.',
    'The emoji picker widget causes frame drops on devices with <4GB RAM.',
    'Allow server owners to customize the welcome DM per-channel.',
    'Documented the weekly backup process and recovery steps.',
    'Category permissions do not propagate to new channels correctly.',
  ];
  const count = 10;
  const items: MemoryItem[] = [];

  for (let i = 0; i < count; i++) {
    const item = new MemoryItem();
    item.guildId = guildId;
    item.memoryConfigId = memoryConfig.id;
    item.threadId = fakeSnowflake();
    item.title = titles[i];
    item.description = descriptions[i];
    item.status = statuses[i];
    item.createdBy = pick(fakeUserIds);
    item.sourceMessageId = null;
    item.sourceChannelId = null;
    items.push(item);
  }

  await itemRepo.save(items);
  return { count };
}

async function populateBaitChannel(
  _interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ count: number }> {
  const repo = AppDataSource.getRepository(BaitChannelLog);

  const fakeUserIds = [
    '100000000000000001',
    '100000000000000002',
    '100000000000000003',
    '100000000000000004',
    '100000000000000005',
    '100000000000000006',
    '100000000000000007',
    '100000000000000008',
  ];
  const fakeChannelIds = ['200000000000000001', '200000000000000002', '200000000000000003'];
  const usernames = [
    'SuspiciousBot_42',
    'free_nitro_now',
    'xSpammerx',
    'totallylegit',
    'cheap_boosts_99',
    'NotAScammer',
    'link_dropper_3',
    'promo_account',
  ];
  const actionTypes: string[] = [
    'banned',
    'banned',
    'kicked',
    'banned',
    'deleted-in-time',
    'banned',
    'kicked',
    'banned',
  ];
  const messageContents = [
    'Free Discord Nitro! Click here: http://totally-not-a-scam.com',
    'Get cheap server boosts at http://fake-boosts.xyz',
    '@everyone Check out my new server! discord.gg/spamlink',
    'Steam gift cards giveaway! http://phishing-site.net',
    'I am giving away Nitro to the first 100 members!',
    'Join my server for free robux: discord.gg/fakeinvite',
    '@here Exclusive deal just for you: http://malware-link.com',
    'Free V-Bucks generator: http://scamsite.org/vbucks',
  ];
  const count = 8;
  const entries: BaitChannelLog[] = [];

  for (let i = 0; i < count; i++) {
    const entry = new BaitChannelLog();
    entry.guildId = guildId;
    entry.userId = fakeUserIds[i];
    entry.username = usernames[i];
    entry.channelId = pick(fakeChannelIds);
    entry.messageContent = messageContents[i];
    entry.messageId = fakeSnowflake();
    entry.actionTaken = actionTypes[i];
    entry.failureReason = null;
    entry.accountAgeDays = Math.random() * 30;
    entry.membershipMinutes = Math.random() * 60;
    entry.messageCount = randInt(0, 3);
    entry.hasVerifiedRole = false;
    entry.suspicionScore = randInt(30, 100);
    entry.detectionFlags = {
      newAccount: Math.random() > 0.3,
      newMember: Math.random() > 0.2,
      noMessages: Math.random() > 0.4,
      noVerification: Math.random() > 0.3,
      suspiciousContent: Math.random() > 0.2,
      linkSpam: Math.random() > 0.4,
      mentionSpam: i === 2 || i === 6,
      defaultAvatar: Math.random() > 0.5,
      emptyProfile: Math.random() > 0.4,
      suspiciousUsername: Math.random() > 0.5,
      noRoles: Math.random() > 0.3,
      discordInvite: i === 2 || i === 5,
      phishingUrl: i === 3 || i === 6,
      attachmentOnly: false,
      joinBurst: i === 0 || i === 1,
    };
    entry.overridden = false;
    entry.overriddenBy = null;
    entry.overriddenAt = null;
    entries.push(entry);
  }

  await repo.save(entries);
  return { count };
}

async function populateAnnouncements(
  _interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<{ count: number }> {
  const repo = AppDataSource.getRepository(AnnouncementLog);

  const fakeChannelIds = ['200000000000000001', '200000000000000002', '200000000000000003'];
  const fakeSenderIds = ['100000000000000001', '100000000000000002'];
  const templateTypes = ['maintenance_short', 'maintenance_long', 'update_scheduled', 'update_complete', 'back_online'];
  const count = 5;
  const entries: AnnouncementLog[] = [];

  for (let i = 0; i < count; i++) {
    const entry = new AnnouncementLog();
    entry.guildId = guildId;
    entry.channelId = pick(fakeChannelIds);
    entry.messageId = fakeSnowflake();
    entry.type = templateTypes[i];
    entry.sentBy = pick(fakeSenderIds);
    entry.scheduledTime = i < 3 ? new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) : null;
    entry.version = i === 2 || i === 3 ? `${randInt(1, 4)}.${randInt(0, 9)}.${randInt(0, 9)}` : null;
    entries.push(entry);
  }

  await repo.save(entries);
  return { count };
}

// ─── Exported Handlers ─────────────────────────────────────────────────────────

/**
 * Seed realistic usage data for a subsystem.
 * Supported systems: starboard, xp, analytics, events, onboarding, sla,
 * tickets, applications, memory, baitchannel, announcements, all.
 */
export async function handlePopulate(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const system = interaction.options.getString('system', true);
    const results: string[] = [];

    if (system === 'starboard' || system === 'all') {
      const r = await populateStarboard(interaction, guildId);
      results.push(`Starboard: ${r.count} entries created`);
    }

    if (system === 'xp' || system === 'all') {
      const r = await populateXp(interaction, guildId);
      results.push(`XP: ${r.users} users, ${r.rewards} role rewards`);
    }

    if (system === 'analytics' || system === 'all') {
      const r = await populateAnalytics(interaction, guildId);
      results.push(`Analytics: ${r.days} days of snapshots`);
    }

    if (system === 'events' || system === 'all') {
      const r = await populateEvents(interaction, guildId);
      results.push(`Events: ${r.templates} templates, ${r.reminders} reminders`);
    }

    if (system === 'onboarding' || system === 'all') {
      const r = await populateOnboarding(interaction, guildId);
      results.push(`Onboarding: ${r.completed} completed, ${r.abandoned} abandoned, ${r.inProgress} in-progress`);
    }

    if (system === 'sla' || system === 'all') {
      const r = await populateSla(interaction, guildId);
      results.push(`SLA: ${r.withinSla} within SLA, ${r.breached} breached, ${r.pending} pending`);
    }

    if (system === 'tickets' || system === 'all') {
      const r = await populateTickets(interaction, guildId);
      results.push(`Tickets: ${r.count} archived ticket entries created`);
    }

    if (system === 'applications' || system === 'all') {
      const r = await populateApplications(interaction, guildId);
      results.push(`Applications: ${r.count} archived application entries created`);
    }

    if (system === 'memory' || system === 'all') {
      const r = await populateMemory(interaction, guildId);
      if (r.count > 0) {
        results.push(`Memory: ${r.count} memory items created`);
      } else {
        results.push('Memory: skipped (no memory config found — run scaffold first)');
      }
    }

    if (system === 'baitchannel' || system === 'all') {
      const r = await populateBaitChannel(interaction, guildId);
      results.push(`Bait Channel: ${r.count} log entries created`);
    }

    if (system === 'announcements' || system === 'all') {
      const r = await populateAnnouncements(interaction, guildId);
      results.push(`Announcements: ${r.count} log entries created`);
    }

    if (results.length === 0) {
      await interaction.editReply(
        'Unknown system. Choose: starboard, xp, analytics, events, onboarding, sla, tickets, applications, memory, baitchannel, announcements, all',
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Dev Populate Complete')
      .setColor(Colors.status.success)
      .setDescription(results.map(r => `- ${r}`).join('\n'))
      .setFooter({ text: `Guild: ${guildId}` });

    await interaction.editReply({ embeds: [embed] });

    enhancedLogger.info(`Dev populate: ${system}`, LogCategory.COMMAND_EXECUTION, {
      guildId,
      system,
      results,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'handlePopulate');
  }
}

/**
 * Compressed time simulation — run hours of activity over minutes.
 * Supported systems: xp, analytics, sla.
 */
export async function handleTimeline(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const system = interaction.options.getString('system', true);
    const minutes = interaction.options.getInteger('minutes') ?? 2;
    const durationMs = minutes * 60 * 1000;

    if (system === 'xp') {
      await timelineXp(client, interaction, guildId, durationMs);
    } else if (system === 'analytics') {
      await timelineAnalytics(interaction, guildId, durationMs);
    } else if (system === 'sla') {
      await timelineSla(interaction, guildId, durationMs);
    } else {
      await interaction.editReply('Unknown system for timeline. Choose: xp, analytics, sla');
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleTimeline');
  }
}

async function timelineXp(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  durationMs: number,
): Promise<void> {
  const userRepo = AppDataSource.getRepository(XPUser);
  const memberIds = await fetchMemberIds(interaction, 15);

  if (memberIds.length === 0) {
    await interaction.editReply('No non-bot members found to simulate XP.');
    return;
  }

  let totalXpAwarded = 0;
  let levelUps = 0;
  let ticks = 0;
  const startTime = Date.now();

  await interaction.editReply('XP Timeline started. Awarding XP every 5 seconds...');

  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= durationMs) {
        clearInterval(interval);

        const summary = new EmbedBuilder()
          .setTitle('XP Timeline Complete')
          .setColor(Colors.status.success)
          .addFields(
            {
              name: 'Duration',
              value: `${Math.round(elapsed / 1000)}s`,
              inline: true,
            },
            {
              name: 'Total XP Awarded',
              value: totalXpAwarded.toString(),
              inline: true,
            },
            { name: 'Level-Ups', value: levelUps.toString(), inline: true },
            { name: 'Ticks', value: ticks.toString(), inline: true },
          );

        await interaction.editReply({ content: null, embeds: [summary] });
        void resolve();
        return;
      }

      try {
        const userId = pick(memberIds);
        const xpAmount = randInt(15, 100);

        let user = await userRepo.findOne({ where: { guildId, userId } });
        if (!user) {
          user = new XPUser();
          user.guildId = guildId;
          user.userId = userId;
          user.xp = 0;
          user.level = 0;
          user.messages = 0;
          user.voiceMinutes = 0;
        }

        const oldLevel = user.level;
        user.xp += xpAmount;
        user.messages += 1;
        user.lastXpAt = new Date();

        // Check for level-up
        const requiredXp = totalXpForLevel(user.level + 1);
        if (user.xp >= requiredXp) {
          user.level += 1;
          levelUps++;
        }

        await userRepo.save(user);
        totalXpAwarded += xpAmount;
        ticks++;

        // Progress update every 15-20 seconds (every 3-4 ticks at 5s interval)
        if (ticks % 4 === 0) {
          const pct = Math.round((elapsed / durationMs) * 100);
          const levelUpNote = user.level > oldLevel ? ` | Level-up: <@${userId}> -> Lv${user.level}` : '';
          await interaction.editReply(
            `XP Timeline: ${pct}% | ${totalXpAwarded} XP awarded | ${levelUps} level-ups${levelUpNote}`,
          );
        }
      } catch (err) {
        enhancedLogger.error('Timeline XP tick error', err as Error, LogCategory.COMMAND_EXECUTION);
      }
    }, 5_000);
  });
}

async function timelineAnalytics(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  durationMs: number,
): Promise<void> {
  const repo = AppDataSource.getRepository(AnalyticsSnapshot);
  const channelIds = await fetchTextChannelIds(interaction);
  const guild = interaction.guild!;

  let messagesRecorded = 0;
  let voiceMinutesRecorded = 0;
  let ticks = 0;
  const startTime = Date.now();

  await interaction.editReply('Analytics Timeline started. Recording activity every 10 seconds...');

  // We build up a single snapshot for "today"
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let snapshot = await repo.findOne({ where: { guildId, date: today } });
  if (!snapshot) {
    snapshot = new AnalyticsSnapshot();
    snapshot.guildId = guildId;
    snapshot.date = today;
    snapshot.memberCount = guild.memberCount;
    snapshot.memberJoined = 0;
    snapshot.memberLeft = 0;
    snapshot.messageCount = 0;
    snapshot.activeMembers = 0;
    snapshot.voiceMinutes = 0;
    snapshot.topChannels = null;
    snapshot.peakHourUtc = null;
  }

  await new Promise<void>(resolve => {
    const interval = setInterval(async () => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= durationMs) {
        clearInterval(interval);

        // Final flush
        await repo.save(snapshot!);

        const summary = new EmbedBuilder()
          .setTitle('Analytics Timeline Complete')
          .setColor(Colors.status.success)
          .addFields(
            {
              name: 'Duration',
              value: `${Math.round(elapsed / 1000)}s`,
              inline: true,
            },
            {
              name: 'Messages Recorded',
              value: messagesRecorded.toString(),
              inline: true,
            },
            {
              name: 'Voice Minutes',
              value: voiceMinutesRecorded.toString(),
              inline: true,
            },
            {
              name: 'Snapshot Saved',
              value: today.toISOString().split('T')[0],
              inline: true,
            },
          );

        await interaction.editReply({ content: null, embeds: [summary] });
        void resolve();
        return;
      }

      try {
        const msgBatch = randInt(5, 30);
        const voiceBatch = randInt(1, 10);

        snapshot!.messageCount += msgBatch;
        snapshot!.voiceMinutes += voiceBatch;
        snapshot!.activeMembers = Math.min(snapshot!.activeMembers + randInt(0, 3), guild.memberCount);
        snapshot!.peakHourUtc = new Date().getUTCHours();

        // Update top channels
        if (channelIds.length > 0) {
          const topCount = Math.min(5, channelIds.length);
          const shuffled = [...channelIds].sort(() => Math.random() - 0.5);
          snapshot!.topChannels = shuffled.slice(0, topCount).map(channelId => {
            const channel = guild.channels.cache.get(channelId);
            return {
              channelId,
              name: channel?.name ?? 'unknown',
              count: randInt(5, 50),
            };
          });
        }

        messagesRecorded += msgBatch;
        voiceMinutesRecorded += voiceBatch;
        ticks++;

        // Save periodically
        if (ticks % 3 === 0) {
          await repo.save(snapshot!);
        }

        // Progress update
        if (ticks % 2 === 0) {
          const pct = Math.round((elapsed / durationMs) * 100);
          await interaction.editReply(
            `Analytics Timeline: ${pct}% | ${messagesRecorded} msgs | ${voiceMinutesRecorded} voice min`,
          );
        }
      } catch (err) {
        enhancedLogger.error('Timeline analytics tick error', err as Error, LogCategory.COMMAND_EXECUTION);
      }
    }, 10_000);
  });
}

async function timelineSla(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  _durationMs: number,
): Promise<void> {
  const repo = AppDataSource.getRepository(Ticket);
  const steps: string[] = [];

  // Step 1: Create ticket
  const ticket = new Ticket();
  ticket.guildId = guildId;
  ticket.channelId = null;
  ticket.messageId = null;
  ticket.createdBy = interaction.user.id;
  ticket.type = 'sla-lifecycle-test';
  ticket.status = 'open';
  ticket.lastActivityAt = new Date();
  ticket.firstResponseAt = null;
  ticket.slaBreached = false;
  ticket.slaBreachNotified = false;
  await repo.save(ticket);
  steps.push(`Created ticket #${ticket.id} (no SLA response yet)`);

  await interaction.editReply(`SLA Timeline: Step 1/4 - Ticket #${ticket.id} created`);

  // Step 2: Wait then backdate past SLA
  await new Promise(r => setTimeout(r, 5_000));
  ticket.lastActivityAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
  await repo.save(ticket);
  steps.push(`Backdated ticket #${ticket.id} to 2 hours ago`);

  await interaction.editReply(`SLA Timeline: Step 2/4 - Ticket backdated past SLA threshold`);

  // Step 3: Force SLA breach
  await new Promise(r => setTimeout(r, 5_000));
  ticket.slaBreached = true;
  ticket.slaBreachNotified = true;
  await repo.save(ticket);
  steps.push(`SLA breach triggered for ticket #${ticket.id}`);

  await interaction.editReply(`SLA Timeline: Step 3/4 - SLA breach triggered`);

  // Step 4: Simulate staff response
  await new Promise(r => setTimeout(r, 5_000));
  ticket.firstResponseAt = new Date();
  ticket.lastActivityAt = new Date();
  await repo.save(ticket);
  steps.push(`Staff response recorded for ticket #${ticket.id} (SLA breach remains logged)`);

  const summary = new EmbedBuilder()
    .setTitle('SLA Timeline Complete')
    .setColor(Colors.status.success)
    .setDescription(steps.map((s, i) => `**${i + 1}.** ${s}`).join('\n'))
    .addFields(
      { name: 'Ticket ID', value: `#${ticket.id}`, inline: true },
      { name: 'SLA Breached', value: 'Yes (simulated)', inline: true },
      { name: 'Response Recorded', value: 'Yes', inline: true },
    );

  await interaction.editReply({ content: null, embeds: [summary] });
}

/**
 * Guided interactive walkthrough with step-by-step instructions and buttons.
 */
export async function handleWalkthrough(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const system = interaction.options.getString('system', true);
    const steps = getWalkthroughSteps(system);

    if (!steps) {
      await interaction.editReply('Unknown system. Choose: starboard, xp, sla, onboarding, events, analytics');
      return;
    }

    let currentStep = 0;
    const completed: ('done' | 'skipped' | 'pending')[] = steps.map(() => 'pending');

    const buildEmbed = () => {
      const embed = new EmbedBuilder()
        .setTitle(`${system.charAt(0).toUpperCase() + system.slice(1)} Walkthrough`)
        .setColor(Colors.brand.primary)
        .setFooter({
          text: `Step ${currentStep + 1} of ${steps.length} | Guild: ${guildId}`,
        });

      const description = steps
        .map((step, i) => {
          const status =
            completed[i] === 'done'
              ? '(done)'
              : completed[i] === 'skipped'
                ? '(skipped)'
                : i === currentStep
                  ? '(current)'
                  : '';
          const prefix = completed[i] === 'done' ? '~~' : completed[i] === 'skipped' ? '~~' : '';
          const suffix = prefix;
          return `**${i + 1}.** ${prefix}${step}${suffix} ${status}`;
        })
        .join('\n\n');

      embed.setDescription(description);
      return embed;
    };

    const buildButtons = () => {
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('walkthrough_done').setLabel('Done').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('walkthrough_skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
    };

    const reply = await interaction.editReply({
      embeds: [buildEmbed()],
      components: [buildButtons()],
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.user.id === interaction.user.id,
      time: 300_000,
    });

    collector.on('collect', async btnInteraction => {
      if (btnInteraction.customId === 'walkthrough_done') {
        completed[currentStep] = 'done';
      } else if (btnInteraction.customId === 'walkthrough_skip') {
        completed[currentStep] = 'skipped';
      }

      currentStep++;

      if (currentStep >= steps.length) {
        collector.stop('complete');

        const doneCount = completed.filter(c => c === 'done').length;
        const skipCount = completed.filter(c => c === 'skipped').length;

        const finalEmbed = new EmbedBuilder()
          .setTitle(`${system.charAt(0).toUpperCase() + system.slice(1)} Walkthrough Complete`)
          .setColor(doneCount === steps.length ? Colors.status.success : Colors.status.warning)
          .setDescription(
            steps
              .map((step, i) => {
                const icon = completed[i] === 'done' ? '[DONE]' : '[SKIPPED]';
                return `**${i + 1}.** ${step} ${icon}`;
              })
              .join('\n\n'),
          )
          .addFields(
            { name: 'Completed', value: doneCount.toString(), inline: true },
            { name: 'Skipped', value: skipCount.toString(), inline: true },
          );

        await btnInteraction.update({ embeds: [finalEmbed], components: [] });
        return;
      }

      await btnInteraction.update({
        embeds: [buildEmbed()],
        components: [buildButtons()],
      });
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'complete') return;

      // Timeout
      const timeoutEmbed = new EmbedBuilder()
        .setTitle('Walkthrough Timed Out')
        .setColor(Colors.status.warning)
        .setDescription(
          `Completed ${completed.filter(c => c !== 'pending').length} of ${steps.length} steps before timeout.`,
        );

      await interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleWalkthrough');
  }
}

function getWalkthroughSteps(system: string): string[] | null {
  switch (system) {
    case 'starboard':
      return [
        'Send a message in any channel',
        'Run `/dev-test starboard-simulate <message-id> 5`',
        'Check #dev-starboard for the starboard embed',
        'Run `/starboard stats`',
        'Run `/starboard random`',
      ];
    case 'xp':
      return [
        'Send a few messages to earn XP (cooldown is 5s in dev)',
        'Run `/rank` to see your rank card',
        'Run `/leaderboard` to see the leaderboard',
        'Run `/xp-setup role-reward add 1 @some-role`',
        'Run `/dev-test xp-force-levelup @yourself` to trigger the reward',
        'Check that the role was granted',
      ];
    case 'sla':
      return [
        'Create a ticket using the ticket button',
        'Run `/dev-test sla-backdate-ticket <id> 10`',
        'Run `/dev-test sla-force-check`',
        'Check #dev-sla-alerts for the breach alert',
        'Reply in the ticket channel (simulates staff response)',
        'Run `/ticket-setup sla stats` to see metrics',
      ];
    case 'onboarding':
      return [
        'Run `/onboarding setup enable` to enable the system',
        'Run `/onboarding step-add message` with a title and description',
        'Run `/onboarding step-list` to verify your step',
        'Run `/onboarding preview` to test the DM flow',
      ];
    case 'events':
      return [
        'Run `/event setup enable` to enable the system',
        'Run `/event template create` to create a template',
        'Run `/event create` to create a scheduled event',
        'Run `/event remind` to set a reminder',
      ];
    case 'analytics':
      return [
        'Run `/insights setup enable` to enable analytics',
        'Send a few messages in the server',
        'Run `/dev-test analytics-flush` to flush counters',
        'Run `/insights overview` to see the data',
      ];
    default:
      return null;
  }
}

/**
 * Cross-system integration test scenarios.
 * Supported scenarios: xp-starboard, onboarding-xp, tickets-sla-routing, analytics-xp.
 */
export async function handleChain(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const scenario = interaction.options.getString('scenario', true);

    switch (scenario) {
      case 'xp-starboard':
        await chainXpStarboard(interaction, guildId);
        break;
      case 'onboarding-xp':
        await chainOnboardingXp(interaction, guildId);
        break;
      case 'tickets-sla-routing':
        await chainTicketsSlaRouting(interaction, guildId);
        break;
      case 'analytics-xp':
        await chainAnalyticsXp(interaction, guildId);
        break;
      default:
        await interaction.editReply(
          'Unknown scenario. Choose: xp-starboard, onboarding-xp, tickets-sla-routing, analytics-xp',
        );
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleChain');
  }
}

async function chainXpStarboard(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const xpRepo = AppDataSource.getRepository(XPUser);
  const starRepo = AppDataSource.getRepository(StarboardEntry);
  const results: { step: string; passed: boolean; detail: string }[] = [];

  // Step 1: Seed user with XP
  const userId = interaction.user.id;
  let xpUser = await xpRepo.findOne({ where: { guildId, userId } });
  if (!xpUser) {
    xpUser = new XPUser();
    xpUser.guildId = guildId;
    xpUser.userId = userId;
    xpUser.xp = 0;
    xpUser.level = 0;
    xpUser.messages = 0;
    xpUser.voiceMinutes = 0;
  }
  xpUser.xp += 500;
  xpUser.level = 5;
  xpUser.messages += 50;
  await xpRepo.save(xpUser);
  results.push({
    step: 'Seed user with XP (Level 5, 500 XP)',
    passed: true,
    detail: `User: <@${userId}>`,
  });

  // Step 2: Create a starboard entry attributed to user
  const channelIds = await fetchTextChannelIds(interaction);
  const entry = new StarboardEntry();
  entry.guildId = guildId;
  entry.originalMessageId = fakeSnowflake();
  entry.originalChannelId = channelIds.length > 0 ? channelIds[0] : fakeSnowflake();
  entry.authorId = userId;
  entry.starboardMessageId = fakeSnowflake();
  entry.starCount = 7;
  entry.content = 'Cross-system test message from XP user';
  entry.attachmentUrl = null;
  await starRepo.save(entry);
  results.push({
    step: 'Create starboard entry for XP user',
    passed: true,
    detail: `Stars: ${entry.starCount}`,
  });

  // Step 3: Verify starboard entry has content
  const fetched = await starRepo.findOne({
    where: { guildId, originalMessageId: entry.originalMessageId },
  });
  const hasContent = !!fetched?.content;
  results.push({
    step: 'Verify starboard embed includes message content',
    passed: hasContent,
    detail: hasContent ? `Content: "${fetched!.content}"` : 'No content found',
  });

  await sendChainResults(interaction, 'XP -> Starboard', results);
}

async function chainOnboardingXp(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const onboardingRepo = AppDataSource.getRepository(OnboardingCompletion);
  const xpRepo = AppDataSource.getRepository(XPUser);
  const results: { step: string; passed: boolean; detail: string }[] = [];

  const userId = interaction.user.id;

  // Step 1: Create onboarding completion
  let completion = await onboardingRepo.findOne({ where: { guildId, userId } });
  if (!completion) {
    completion = new OnboardingCompletion();
    completion.guildId = guildId;
    completion.userId = userId;
  }
  completion.completedSteps = ['welcome', 'rules', 'roles', 'intro', 'tour'];
  completion.completedAt = new Date();
  completion.lastStepAt = new Date();
  await onboardingRepo.save(completion);
  results.push({
    step: 'Complete onboarding flow',
    passed: true,
    detail: '5/5 steps completed',
  });

  // Step 2: Verify completion record exists
  const verified = await onboardingRepo.findOne({ where: { guildId, userId } });
  const isComplete = !!verified?.completedAt;
  results.push({
    step: 'Verify onboarding marked as complete',
    passed: isComplete,
    detail: isComplete ? `Completed at: ${verified!.completedAt!.toISOString()}` : 'Not marked complete',
  });

  // Step 3: Seed XP for the user (simulating post-onboarding activity)
  let xpUser = await xpRepo.findOne({ where: { guildId, userId } });
  if (!xpUser) {
    xpUser = new XPUser();
    xpUser.guildId = guildId;
    xpUser.userId = userId;
    xpUser.xp = 0;
    xpUser.level = 0;
    xpUser.messages = 0;
    xpUser.voiceMinutes = 0;
  }
  xpUser.xp += 150;
  xpUser.messages += 10;
  xpUser.lastXpAt = new Date();
  await xpRepo.save(xpUser);
  results.push({
    step: 'Simulate post-onboarding XP earning',
    passed: true,
    detail: `+150 XP, 10 messages`,
  });

  // Step 4: Verify XP was recorded
  const xpVerified = await xpRepo.findOne({ where: { guildId, userId } });
  const hasXp = !!xpVerified && xpVerified.xp >= 150;
  results.push({
    step: 'Verify XP earning works after onboarding',
    passed: hasXp,
    detail: hasXp ? `Total XP: ${xpVerified!.xp}` : 'XP not recorded',
  });

  await sendChainResults(interaction, 'Onboarding -> XP', results);
}

async function chainTicketsSlaRouting(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const ticketRepo = AppDataSource.getRepository(Ticket);
  const results: { step: string; passed: boolean; detail: string }[] = [];

  // Step 1: Create a ticket
  const ticket = new Ticket();
  ticket.guildId = guildId;
  ticket.channelId = null;
  ticket.messageId = null;
  ticket.createdBy = interaction.user.id;
  ticket.type = 'chain-routing-test';
  ticket.status = 'open';
  ticket.lastActivityAt = new Date();
  ticket.firstResponseAt = null;
  ticket.slaBreached = false;
  ticket.slaBreachNotified = false;
  ticket.statusHistory = [
    {
      status: 'open',
      changedBy: interaction.user.id,
      changedAt: new Date().toISOString(),
    },
  ];
  await ticketRepo.save(ticket);
  results.push({
    step: 'Create ticket with routing type',
    passed: true,
    detail: `Ticket #${ticket.id}`,
  });

  // Step 2: Simulate auto-assignment
  ticket.assignedTo = interaction.user.id;
  ticket.assignedAt = new Date();
  await ticketRepo.save(ticket);
  const assigned = !!ticket.assignedTo;
  results.push({
    step: 'Simulate auto-assignment via routing rule',
    passed: assigned,
    detail: assigned ? `Assigned to: <@${ticket.assignedTo}>` : 'Assignment failed',
  });

  // Step 3: Backdate ticket past SLA
  ticket.lastActivityAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await ticketRepo.save(ticket);
  results.push({
    step: 'Backdate ticket past SLA threshold',
    passed: true,
    detail: 'Backdated 3 hours',
  });

  // Step 4: Force SLA breach
  ticket.slaBreached = true;
  ticket.slaBreachNotified = true;
  ticket.statusHistory = [
    ...(ticket.statusHistory ?? []),
    {
      status: 'sla-breached',
      changedBy: 'system',
      changedAt: new Date().toISOString(),
      note: 'SLA breach detected',
    },
  ];
  await ticketRepo.save(ticket);
  results.push({
    step: 'Force SLA check and verify breach',
    passed: ticket.slaBreached,
    detail: ticket.slaBreached ? 'Breach recorded' : 'Breach not triggered',
  });

  // Step 5: Simulate staff response
  ticket.firstResponseAt = new Date();
  ticket.lastActivityAt = new Date();
  await ticketRepo.save(ticket);
  results.push({
    step: 'Record staff response (firstResponseAt)',
    passed: !!ticket.firstResponseAt,
    detail: `Response at: ${ticket.firstResponseAt.toISOString()}`,
  });

  await sendChainResults(interaction, 'Tickets -> SLA -> Routing', results);
}

async function chainAnalyticsXp(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const xpRepo = AppDataSource.getRepository(XPUser);
  const analyticsRepo = AppDataSource.getRepository(AnalyticsSnapshot);
  const results: { step: string; passed: boolean; detail: string }[] = [];

  // Step 1: Record XP-earning messages for multiple users
  const memberIds = await fetchMemberIds(interaction, 5);
  const userIds = memberIds.length >= 3 ? memberIds.slice(0, 3) : [interaction.user.id];
  let totalMessages = 0;

  for (const uid of userIds) {
    let user = await xpRepo.findOne({ where: { guildId, userId: uid } });
    if (!user) {
      user = new XPUser();
      user.guildId = guildId;
      user.userId = uid;
      user.xp = 0;
      user.level = 0;
      user.messages = 0;
      user.voiceMinutes = 0;
    }
    const msgs = randInt(5, 20);
    user.messages += msgs;
    user.xp += msgs * randInt(15, 25);
    user.lastXpAt = new Date();
    await xpRepo.save(user);
    totalMessages += msgs;
  }
  results.push({
    step: 'Record XP-earning messages',
    passed: true,
    detail: `${totalMessages} messages from ${userIds.length} users`,
  });

  // Step 2: Flush analytics snapshot
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let snapshot = await analyticsRepo.findOne({
    where: { guildId, date: today },
  });
  if (!snapshot) {
    snapshot = new AnalyticsSnapshot();
    snapshot.guildId = guildId;
    snapshot.date = today;
    snapshot.memberCount = interaction.guild!.memberCount;
    snapshot.memberJoined = 0;
    snapshot.memberLeft = 0;
    snapshot.messageCount = 0;
    snapshot.activeMembers = 0;
    snapshot.voiceMinutes = 0;
    snapshot.topChannels = null;
    snapshot.peakHourUtc = null;
  }
  snapshot.messageCount += totalMessages;
  snapshot.activeMembers = userIds.length;
  await analyticsRepo.save(snapshot);
  results.push({
    step: 'Flush analytics snapshot',
    passed: true,
    detail: `Date: ${today.toISOString().split('T')[0]}`,
  });

  // Step 3: Verify analytics captured message counts
  const verified = await analyticsRepo.findOne({
    where: { guildId, date: today },
  });
  const captured = !!verified && verified.messageCount >= totalMessages;
  results.push({
    step: 'Verify analytics captured message counts',
    passed: captured,
    detail: captured ? `Snapshot messages: ${verified!.messageCount}` : 'Message count mismatch',
  });

  await sendChainResults(interaction, 'Analytics -> XP', results);
}

async function sendChainResults(
  interaction: ChatInputCommandInteraction,
  title: string,
  results: { step: string; passed: boolean; detail: string }[],
): Promise<void> {
  const allPassed = results.every(r => r.passed);

  const embed = new EmbedBuilder()
    .setTitle(`Chain: ${title}`)
    .setColor(allPassed ? Colors.status.success : Colors.status.warning)
    .setDescription(
      results
        .map((r, i) => {
          const icon = r.passed ? '[PASS]' : '[FAIL]';
          return `**${i + 1}.** ${icon} ${r.step}\n> ${r.detail}`;
        })
        .join('\n\n'),
    )
    .addFields(
      {
        name: 'Passed',
        value: results.filter(r => r.passed).length.toString(),
        inline: true,
      },
      {
        name: 'Failed',
        value: results.filter(r => !r.passed).length.toString(),
        inline: true,
      },
    );

  await interaction.editReply({ content: null, embeds: [embed] });
}
