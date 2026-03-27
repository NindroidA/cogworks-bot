import { ChannelType, type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from '../../../typeorm/entities/announcement/AnnouncementLog';
import { AnnouncementTemplate } from '../../../typeorm/entities/announcement/AnnouncementTemplate';
import { Application } from '../../../typeorm/entities/application/Application';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplication } from '../../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import { BaitChannelLog } from '../../../typeorm/entities/BaitChannelLog';
import { BaitKeyword } from '../../../typeorm/entities/bait/BaitKeyword';
import { JoinEvent } from '../../../typeorm/entities/bait/JoinEvent';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../../../typeorm/entities/event/EventTemplate';
import { MemoryConfig } from '../../../typeorm/entities/memory/MemoryConfig';
import { MemoryItem } from '../../../typeorm/entities/memory/MemoryItem';
import { MemoryTag } from '../../../typeorm/entities/memory/MemoryTag';
import { OnboardingCompletion } from '../../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { PendingBan } from '../../../typeorm/entities/PendingBan';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole/ReactionRoleMenu';
import { ReactionRoleOption } from '../../../typeorm/entities/reactionRole/ReactionRoleOption';
import { RulesConfig } from '../../../typeorm/entities/rules/RulesConfig';
import { StarboardConfig } from '../../../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../../../typeorm/entities/starboard/StarboardEntry';
import { ArchivedTicket } from '../../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { UserTicketRestriction } from '../../../typeorm/entities/ticket/UserTicketRestriction';
import { XPConfig } from '../../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { enhancedLogger, handleInteractionError, LogCategory, requireBotOwner } from '../../../utils';
import type { OnboardingStepDef } from '../../../utils/onboarding/types';
import { seedDefaultTemplates } from '../announcement/templates';

type SystemName =
  | 'starboard'
  | 'xp'
  | 'onboarding'
  | 'events'
  | 'analytics'
  | 'sla'
  | 'routing'
  | 'automod'
  | 'tickets'
  | 'applications'
  | 'announcements'
  | 'memory'
  | 'baitchannel'
  | 'rules'
  | 'reactionroles';

const ALL_SYSTEMS: SystemName[] = [
  'starboard',
  'xp',
  'onboarding',
  'events',
  'analytics',
  'sla',
  'routing',
  'automod',
  'tickets',
  'applications',
  'announcements',
  'memory',
  'baitchannel',
  'rules',
  'reactionroles',
];

const DEV_CATEGORY_NAME = 'Dev Testing';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find or create the dev testing category channel.
 */
async function getOrCreateCategory(interaction: ChatInputCommandInteraction, _guildId: string): Promise<string> {
  const guild = interaction.guild!;

  // Check if a category option was provided
  const categoryOption = interaction.options.getChannel('category');
  if (categoryOption) {
    return categoryOption.id;
  }

  // Look for existing "Dev Testing" category
  const existing = guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildCategory && ch.name === DEV_CATEGORY_NAME,
  );
  if (existing) return existing.id;

  // Create it
  const created = await guild.channels.create({
    name: DEV_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  });

  return created.id;
}

/**
 * Create a text channel under the dev category.
 */
async function createDevChannel(
  interaction: ChatInputCommandInteraction,
  name: string,
  categoryId: string,
): Promise<string> {
  const channel = await interaction.guild!.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: categoryId,
  });
  return channel.id;
}

/**
 * Create a forum channel under the dev category.
 */
async function createDevForumChannel(
  interaction: ChatInputCommandInteraction,
  name: string,
  categoryId: string,
): Promise<string> {
  const channel = await interaction.guild!.channels.create({
    name,
    type: ChannelType.GuildForum,
    parent: categoryId,
  });
  return channel.id;
}

/**
 * Delete all channels whose name starts with the given prefix under any category.
 */
async function deleteDevChannels(interaction: ChatInputCommandInteraction, prefix: string): Promise<number> {
  const guild = interaction.guild!;
  let deleted = 0;

  // Refresh cache
  await guild.channels.fetch();

  const matches = guild.channels.cache.filter(
    ch => (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildForum) && ch.name.startsWith(prefix),
  );

  for (const [, channel] of matches) {
    try {
      await channel.delete('[DEV] Scaffold teardown');
      deleted++;
    } catch {
      // Channel may already be gone
    }
  }

  return deleted;
}

// ─── Per-System Scaffold Functions ────────────────────────────────────────────

async function scaffoldStarboard(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const repo = AppDataSource.getRepository(StarboardConfig);

  const existing = await repo.findOneBy({ guildId });
  if (existing) return 'Starboard is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-starboard', categoryId);

  const config = repo.create({
    guildId,
    enabled: true,
    channelId,
    threshold: 1,
    selfStar: true,
    ignoreBots: false,
  });
  await repo.save(config);

  return `Starboard scaffolded: <#${channelId}> (threshold=1, selfStar=true)\nTry: React to any message with a star emoji.`;
}

async function scaffoldXP(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const repo = AppDataSource.getRepository(XPConfig);

  const existing = await repo.findOneBy({ guildId });
  if (existing) return 'XP system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-xp-levelup', categoryId);

  const config = repo.create({
    guildId,
    enabled: true,
    xpPerMessageMin: 50,
    xpPerMessageMax: 100,
    xpCooldownSeconds: 5,
    levelUpChannelId: channelId,
  });
  await repo.save(config);

  return `XP system scaffolded: <#${channelId}> (50-100 XP/msg, 5s cooldown)\nTry: Send a few messages and watch for level-up notifications.`;
}

async function scaffoldOnboarding(
  _client: Client,
  _interaction: ChatInputCommandInteraction,
  guildId: string,
  _categoryId: string,
): Promise<string> {
  const repo = AppDataSource.getRepository(OnboardingConfig);

  const existing = await repo.findOneBy({ guildId });
  if (existing) return 'Onboarding is already configured -- skipped.';

  const sampleSteps: OnboardingStepDef[] = [
    {
      id: 'welcome',
      type: 'message',
      title: 'Welcome!',
      description: 'Thanks for joining the server. Let us walk you through a few things.',
      required: true,
    },
    {
      id: 'roles',
      type: 'role-select',
      title: 'Pick Your Interests',
      description: 'Select the roles that match your interests.',
      options: [
        { label: 'Gaming', roleId: '000000000000000001', emoji: '🎮' },
        { label: 'Music', roleId: '000000000000000002', emoji: '🎵' },
        { label: 'Art', roleId: '000000000000000003', emoji: '🎨' },
      ],
      required: false,
    },
    {
      id: 'rules',
      type: 'rules-accept',
      title: 'Server Rules',
      description: 'Please read and accept the server rules to continue.',
      required: true,
    },
  ];

  const config = repo.create({
    guildId,
    enabled: true,
    welcomeMessage: 'Welcome to {server}! Let us get you set up.',
    steps: sampleSteps,
    completionRoleId: null,
  });
  await repo.save(config);

  return 'Onboarding scaffolded: 3 sample steps (welcome, role-select, rules-accept)\nNote: Role IDs in the role-select step are placeholders. Replace with real role IDs for full testing.\nTry: `/onboarding preview` to see the flow.';
}

async function scaffoldEvents(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const repo = AppDataSource.getRepository(EventConfig);

  const existing = await repo.findOneBy({ guildId });
  if (existing) return 'Events system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-event-reminders', categoryId);

  const config = repo.create({
    guildId,
    enabled: true,
    reminderChannelId: channelId,
    defaultReminderMinutes: 1,
  });
  await repo.save(config);

  return `Events scaffolded: <#${channelId}> (reminders 1 min before)\nTry: Create a scheduled event in Discord and it should trigger a reminder.`;
}

async function scaffoldAnalytics(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const repo = AppDataSource.getRepository(AnalyticsConfig);

  const existing = await repo.findOneBy({ guildId });
  if (existing) return 'Analytics system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-analytics-digest', categoryId);

  const config = repo.create({
    guildId,
    enabled: true,
    digestChannelId: channelId,
    digestFrequency: 'weekly',
  });
  await repo.save(config);

  return `Analytics scaffolded: <#${channelId}> (weekly digest)\nTry: \`/analytics view\` to see current stats.`;
}

async function scaffoldSLA(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

  if (!ticketConfig) {
    return 'Ticket SLA requires an existing ticket system. Run `/ticket-setup` first, then scaffold SLA.';
  }

  if (ticketConfig.slaEnabled) return 'Ticket SLA is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-sla-alerts', categoryId);

  ticketConfig.slaEnabled = true;
  ticketConfig.slaTargetMinutes = 5;
  ticketConfig.slaBreachChannelId = channelId;
  await ticketConfigRepo.save(ticketConfig);

  return `Ticket SLA scaffolded: <#${channelId}> (target=5 min)\nTry: Create a ticket and wait 5 minutes to see an SLA breach alert.`;
}

async function scaffoldRouting(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  _categoryId: string,
): Promise<string> {
  const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

  if (!ticketConfig) {
    return 'Smart Routing requires an existing ticket system. Run `/ticket-setup` first, then scaffold routing.';
  }

  if (ticketConfig.smartRoutingEnabled) return 'Smart Routing is already configured -- skipped.';

  const guild = interaction.guild!;
  ticketConfig.smartRoutingEnabled = true;
  ticketConfig.routingStrategy = 'least-load';
  ticketConfig.routingRules = [
    {
      ticketTypeId: 'default',
      staffRoleId: guild.roles.everyone.id,
      maxOpen: 5,
    },
  ];
  await ticketConfigRepo.save(ticketConfig);

  return 'Smart Routing scaffolded: strategy=least-load, 1 sample rule\nTry: Create a ticket to see automatic staff assignment.';
}

async function scaffoldAutomod(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _guildId: string,
  _categoryId: string,
): Promise<string> {
  const guild = interaction.guild!;

  try {
    // Create a single test keyword rule via the Discord AutoMod API
    await guild.autoModerationRules.create({
      name: '[DEV] Test Keyword Filter',
      eventType: 1, // MESSAGE_SEND
      triggerType: 1, // KEYWORD
      triggerMetadata: {
        keywordFilter: ['dev-test-blocked-word'],
      },
      actions: [
        {
          type: 1, // BLOCK_MESSAGE
          metadata: {
            customMessage: 'This message was blocked by the dev test AutoMod rule.',
          },
        },
      ],
      enabled: true,
    });
  } catch (error) {
    return `AutoMod scaffold failed: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure the bot has Manage Server permissions.`;
  }

  return 'AutoMod scaffolded: keyword rule blocking "dev-test-blocked-word"\nTry: Send a message containing "dev-test-blocked-word" to verify it gets blocked.';
}

async function scaffoldTickets(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(TicketConfig);

  const existing = await configRepo.findOneBy({ guildId });
  if (existing) return 'Tickets system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-tickets', categoryId);
  const forumChannelId = await createDevForumChannel(interaction, 'dev-ticket-archive', categoryId);

  const config = configRepo.create({
    guildId,
    messageId: '0',
    channelId,
    categoryId,
  });
  await configRepo.save(config);

  const archiveConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);
  const archiveConfig = archiveConfigRepo.create({
    guildId,
    messageId: '0',
    channelId: forumChannelId,
  });
  await archiveConfigRepo.save(archiveConfig);

  const typeRepo = AppDataSource.getRepository(CustomTicketType);
  const types = [
    {
      guildId,
      typeId: 'general',
      displayName: 'General',
      emoji: '📩',
      isActive: true,
      isDefault: true,
      sortOrder: 0,
    },
    {
      guildId,
      typeId: 'bug-report',
      displayName: 'Bug Report',
      emoji: '🐛',
      isActive: true,
      isDefault: false,
      sortOrder: 1,
    },
    {
      guildId,
      typeId: 'support',
      displayName: 'Support',
      emoji: '🛟',
      isActive: true,
      isDefault: false,
      sortOrder: 2,
    },
  ];
  for (const t of types) {
    await typeRepo.save(typeRepo.create(t));
  }

  return `Tickets scaffolded: <#${channelId}> + <#${forumChannelId}> (archive), 3 ticket types (general, bug-report, support)\nTry: \`/ticket-setup\` to view, or create a ticket to test the flow.`;
}

async function scaffoldApplications(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(ApplicationConfig);

  const existing = await configRepo.findOneBy({ guildId });
  if (existing) return 'Applications system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-applications', categoryId);
  const forumChannelId = await createDevForumChannel(interaction, 'dev-app-archive', categoryId);

  const config = configRepo.create({
    guildId,
    messageId: '0',
    channelId,
    categoryId,
  });
  await configRepo.save(config);

  const archiveConfigRepo = AppDataSource.getRepository(ArchivedApplicationConfig);
  const archiveConfig = archiveConfigRepo.create({
    guildId,
    messageId: '0',
    channelId: forumChannelId,
  });
  await archiveConfigRepo.save(archiveConfig);

  const positionRepo = AppDataSource.getRepository(Position);
  const positions = [
    {
      guildId,
      title: 'Staff',
      description: 'Apply to become a staff member.',
      emoji: '🛡️',
      isActive: true,
      displayOrder: 0,
    },
    {
      guildId,
      title: 'Moderator',
      description: 'Apply to become a moderator.',
      emoji: '⚔️',
      isActive: true,
      displayOrder: 1,
    },
  ];
  for (const p of positions) {
    await positionRepo.save(positionRepo.create(p));
  }

  return `Applications scaffolded: <#${channelId}> + <#${forumChannelId}> (archive), 2 positions (Staff, Moderator)\nTry: \`/application-setup\` to view, or submit a test application.`;
}

async function scaffoldAnnouncements(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(AnnouncementConfig);

  const existing = await configRepo.findOneBy({ guildId });
  if (existing) return 'Announcements system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-announcements', categoryId);

  const guild = interaction.guild!;
  const firstRole = guild.roles.cache.filter(r => r.id !== guild.id).first();
  const defaultRoleId = firstRole?.id ?? guild.id;

  const config = configRepo.create({
    guildId,
    defaultRoleId,
    defaultChannelId: channelId,
  });
  await configRepo.save(config);

  const seeded = await seedDefaultTemplates(guildId);

  return `Announcements scaffolded: <#${channelId}> (defaultRole=<@&${defaultRoleId}>, ${seeded} default templates seeded)\nTry: \`/announcement send\` to send a test announcement.`;
}

async function scaffoldMemory(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(MemoryConfig);

  const existing = await configRepo.findOneBy({ guildId });
  if (existing) return 'Memory system is already configured -- skipped.';

  const forumChannelId = await createDevForumChannel(interaction, 'dev-memory', categoryId);

  const config = configRepo.create({
    guildId,
    channelName: 'dev-memory',
    forumChannelId,
    sortOrder: 0,
  });
  const savedConfig = await configRepo.save(config);

  const tagRepo = AppDataSource.getRepository(MemoryTag);
  const tags = [
    {
      guildId,
      memoryConfigId: savedConfig.id,
      name: 'Bug',
      emoji: '🐛',
      tagType: 'category' as const,
      isDefault: true,
    },
    {
      guildId,
      memoryConfigId: savedConfig.id,
      name: 'Feature',
      emoji: '✨',
      tagType: 'category' as const,
      isDefault: true,
    },
    {
      guildId,
      memoryConfigId: savedConfig.id,
      name: 'Note',
      emoji: '📝',
      tagType: 'category' as const,
      isDefault: true,
    },
    {
      guildId,
      memoryConfigId: savedConfig.id,
      name: 'Open',
      emoji: '🟢',
      tagType: 'status' as const,
      isDefault: true,
    },
    {
      guildId,
      memoryConfigId: savedConfig.id,
      name: 'Closed',
      emoji: '🔴',
      tagType: 'status' as const,
      isDefault: true,
    },
  ];
  for (const t of tags) {
    await tagRepo.save(tagRepo.create(t));
  }

  return `Memory scaffolded: <#${forumChannelId}> (forum), 5 default tags (Bug, Feature, Note, Open, Closed)\nTry: \`/memory add\` to create a memory item.`;
}

async function scaffoldBaitChannel(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(BaitChannelConfig);

  const existing = await configRepo.findOneBy({ guildId });
  if (existing) return 'Bait channel system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-bait-trap', categoryId);
  const logChannelId = await createDevChannel(interaction, 'dev-bait-logs', categoryId);

  const config = configRepo.create({
    guildId,
    channelId,
    actionType: 'log-only' as const,
    testMode: true,
    logChannelId,
    enabled: true,
  });
  await configRepo.save(config);

  return `Bait channel scaffolded: <#${channelId}> (trap) + <#${logChannelId}> (logs), actionType=log-only, testMode=true\nTry: Post a message in the trap channel to trigger a detection log.`;
}

async function scaffoldRules(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(RulesConfig);

  const existing = await configRepo.findOneBy({ guildId });
  if (existing) return 'Rules system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-rules', categoryId);

  const guild = interaction.guild!;
  const firstRole = guild.roles.cache.filter(r => r.id !== guild.id).first();
  const roleId = firstRole?.id ?? guild.id;

  // Send rules message and add reaction
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return 'Failed to fetch dev-rules channel after creation.';
  }

  const rulesEmbed = new EmbedBuilder()
    .setTitle('[DEV] Server Rules')
    .setDescription('React with ✅ to accept the rules and receive the assigned role.')
    .setColor(0x57f287);

  const rulesMessage = await channel.send({ embeds: [rulesEmbed] });
  await rulesMessage.react('✅');

  const config = configRepo.create({
    guildId,
    channelId,
    messageId: rulesMessage.id,
    roleId,
    emoji: '✅',
  });
  await configRepo.save(config);

  return `Rules scaffolded: <#${channelId}> (role=<@&${roleId}>, emoji=✅, message sent with reaction)\nTry: React with ✅ on the rules message to receive the role.`;
}

async function scaffoldReactionRoles(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
  categoryId: string,
): Promise<string> {
  const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

  const existing = await menuRepo.findOneBy({ guildId });
  if (existing) return 'Reaction roles system is already configured -- skipped.';

  const channelId = await createDevChannel(interaction, 'dev-reaction-roles', categoryId);

  const guild = interaction.guild!;
  const roles = guild.roles.cache.filter(r => r.id !== guild.id);
  const roleArray = [...roles.values()].slice(0, 3);

  if (roleArray.length === 0) {
    return 'No roles available in the guild to create reaction role options. Create some roles first.';
  }

  const emojis = ['🔴', '🟢', '🔵'];

  // Send the menu embed message
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return 'Failed to fetch dev-reaction-roles channel after creation.';
  }

  const menuEmbed = new EmbedBuilder()
    .setTitle('[DEV] Reaction Roles')
    .setDescription(roleArray.map((r, i) => `${emojis[i]} — <@&${r.id}>`).join('\n'))
    .setColor(0x5865f2);

  const menuMessage = await channel.send({ embeds: [menuEmbed] });

  // Add reactions
  for (let i = 0; i < roleArray.length; i++) {
    await menuMessage.react(emojis[i]);
  }

  const menu = menuRepo.create({
    guildId,
    channelId,
    messageId: menuMessage.id,
    name: 'dev-test-menu',
    description: 'Dev test reaction role menu',
    mode: 'normal',
  });
  const savedMenu = await menuRepo.save(menu);

  const optionRepo = AppDataSource.getRepository(ReactionRoleOption);
  for (let i = 0; i < roleArray.length; i++) {
    const option = optionRepo.create({
      menuId: savedMenu.id,
      emoji: emojis[i],
      roleId: roleArray[i].id,
      description: `Grants ${roleArray[i].name}`,
      sortOrder: i,
    });
    await optionRepo.save(option);
  }

  return `Reaction roles scaffolded: <#${channelId}> (mode=normal, ${roleArray.length} options, message sent with reactions)\nTry: React on the menu message to receive a role.`;
}

// ─── Per-System Teardown Functions ────────────────────────────────────────────

async function teardownStarboard(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(StarboardConfig);
  const entryRepo = AppDataSource.getRepository(StarboardEntry);

  const configResult = await configRepo.delete({ guildId });
  const entryResult = await entryRepo.delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-starboard');

  return `Starboard torn down: ${configResult.affected || 0} config, ${entryResult.affected || 0} entries, ${channelsDeleted} channels deleted.`;
}

async function teardownXP(_client: Client, interaction: ChatInputCommandInteraction, guildId: string): Promise<string> {
  const configRepo = AppDataSource.getRepository(XPConfig);
  const userRepo = AppDataSource.getRepository(XPUser);
  const rewardRepo = AppDataSource.getRepository(XPRoleReward);

  const configResult = await configRepo.delete({ guildId });
  const userResult = await userRepo.delete({ guildId });
  const rewardResult = await rewardRepo.delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-xp');

  return `XP torn down: ${configResult.affected || 0} config, ${userResult.affected || 0} users, ${rewardResult.affected || 0} rewards, ${channelsDeleted} channels deleted.`;
}

async function teardownOnboarding(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(OnboardingConfig);
  const completionRepo = AppDataSource.getRepository(OnboardingCompletion);

  const configResult = await configRepo.delete({ guildId });
  const completionResult = await completionRepo.delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-onboarding');

  return `Onboarding torn down: ${configResult.affected || 0} config, ${completionResult.affected || 0} completions, ${channelsDeleted} channels deleted.`;
}

async function teardownEvents(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(EventConfig);
  const templateRepo = AppDataSource.getRepository(EventTemplate);
  const reminderRepo = AppDataSource.getRepository(EventReminder);

  const configResult = await configRepo.delete({ guildId });
  const templateResult = await templateRepo.delete({ guildId });
  const reminderResult = await reminderRepo.delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-event');

  return `Events torn down: ${configResult.affected || 0} config, ${templateResult.affected || 0} templates, ${reminderResult.affected || 0} reminders, ${channelsDeleted} channels deleted.`;
}

async function teardownAnalytics(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configRepo = AppDataSource.getRepository(AnalyticsConfig);
  const snapshotRepo = AppDataSource.getRepository(AnalyticsSnapshot);

  const configResult = await configRepo.delete({ guildId });
  const snapshotResult = await snapshotRepo.delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-analytics');

  return `Analytics torn down: ${configResult.affected || 0} config, ${snapshotResult.affected || 0} snapshots, ${channelsDeleted} channels deleted.`;
}

async function teardownSLA(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

  if (ticketConfig?.slaEnabled) {
    ticketConfig.slaEnabled = false;
    ticketConfig.slaTargetMinutes = 60;
    ticketConfig.slaBreachChannelId = null;
    ticketConfig.slaPerType = null;
    await ticketConfigRepo.save(ticketConfig);
  }

  const channelsDeleted = await deleteDevChannels(interaction, 'dev-sla');

  return `Ticket SLA torn down: config reset to defaults, ${channelsDeleted} channels deleted.`;
}

async function teardownRouting(
  _client: Client,
  _interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

  if (ticketConfig?.smartRoutingEnabled) {
    ticketConfig.smartRoutingEnabled = false;
    ticketConfig.routingRules = null;
    ticketConfig.routingStrategy = 'least-load';
    await ticketConfigRepo.save(ticketConfig);
  }

  return 'Smart Routing torn down: config reset to defaults.';
}

async function teardownAutomod(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _guildId: string,
): Promise<string> {
  const guild = interaction.guild!;
  let deleted = 0;

  try {
    const rules = await guild.autoModerationRules.fetch();
    for (const [, rule] of rules) {
      if (rule.name.startsWith('[DEV]')) {
        await rule.delete('Dev suite teardown');
        deleted++;
      }
    }
  } catch (error) {
    return `AutoMod teardown failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  return `AutoMod torn down: ${deleted} dev rules deleted.`;
}

async function teardownTickets(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  // Delete forum threads for archived tickets before removing DB records
  let threadsDeleted = 0;
  const archiveConfig = await AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId });
  if (archiveConfig?.channelId) {
    const entries = await AppDataSource.getRepository(ArchivedTicket).find({
      where: { guildId },
    });
    const forumChannel = await client.channels.fetch(archiveConfig.channelId).catch(() => null);
    if (forumChannel && 'threads' in forumChannel) {
      for (const entry of entries) {
        if (!entry.messageId) continue;
        try {
          const thread = await (forumChannel as any).threads.fetch(entry.messageId).catch(() => null);
          if (thread) {
            await thread.delete('Dev suite teardown');
            threadsDeleted++;
          }
        } catch {}
      }
    }
  }

  const configResult = await AppDataSource.getRepository(TicketConfig).delete({
    guildId,
  });
  const archiveConfigResult = await AppDataSource.getRepository(ArchivedTicketConfig).delete({ guildId });
  const typeResult = await AppDataSource.getRepository(CustomTicketType).delete({ guildId });
  const ticketResult = await AppDataSource.getRepository(Ticket).delete({
    guildId,
  });
  const archivedTicketResult = await AppDataSource.getRepository(ArchivedTicket).delete({ guildId });
  const restrictionResult = await AppDataSource.getRepository(UserTicketRestriction).delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-ticket');

  return `Tickets torn down: ${configResult.affected || 0} config, ${archiveConfigResult.affected || 0} archive config, ${typeResult.affected || 0} types, ${ticketResult.affected || 0} tickets, ${archivedTicketResult.affected || 0} archived, ${restrictionResult.affected || 0} restrictions, ${channelsDeleted} channels, ${threadsDeleted} forum threads deleted.`;
}

async function teardownApplications(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configResult = await AppDataSource.getRepository(ApplicationConfig).delete({ guildId });
  const archiveConfigResult = await AppDataSource.getRepository(ArchivedApplicationConfig).delete({ guildId });
  const appResult = await AppDataSource.getRepository(Application).delete({
    guildId,
  });
  const archivedAppResult = await AppDataSource.getRepository(ArchivedApplication).delete({ guildId });
  const positionResult = await AppDataSource.getRepository(Position).delete({
    guildId,
  });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-app');

  return `Applications torn down: ${configResult.affected || 0} config, ${archiveConfigResult.affected || 0} archive config, ${appResult.affected || 0} applications, ${archivedAppResult.affected || 0} archived, ${positionResult.affected || 0} positions, ${channelsDeleted} channels deleted.`;
}

async function teardownAnnouncements(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configResult = await AppDataSource.getRepository(AnnouncementConfig).delete({ guildId });
  const logResult = await AppDataSource.getRepository(AnnouncementLog).delete({
    guildId,
  });
  const templateResult = await AppDataSource.getRepository(AnnouncementTemplate).delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-announcement');

  return `Announcements torn down: ${configResult.affected || 0} config, ${logResult.affected || 0} logs, ${templateResult.affected || 0} templates, ${channelsDeleted} channels deleted.`;
}

async function teardownMemory(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const tagResult = await AppDataSource.getRepository(MemoryTag).delete({
    guildId,
  });
  const itemResult = await AppDataSource.getRepository(MemoryItem).delete({
    guildId,
  });
  const configResult = await AppDataSource.getRepository(MemoryConfig).delete({
    guildId,
  });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-memory');

  return `Memory torn down: ${configResult.affected || 0} config, ${tagResult.affected || 0} tags, ${itemResult.affected || 0} items, ${channelsDeleted} channels deleted.`;
}

async function teardownBaitChannel(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configResult = await AppDataSource.getRepository(BaitChannelConfig).delete({ guildId });
  const logResult = await AppDataSource.getRepository(BaitChannelLog).delete({
    guildId,
  });
  const keywordResult = await AppDataSource.getRepository(BaitKeyword).delete({
    guildId,
  });
  const pendingBanResult = await AppDataSource.getRepository(PendingBan).delete({ guildId });
  const joinEventResult = await AppDataSource.getRepository(JoinEvent).delete({
    guildId,
  });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-bait');

  return `Bait channel torn down: ${configResult.affected || 0} config, ${logResult.affected || 0} logs, ${keywordResult.affected || 0} keywords, ${pendingBanResult.affected || 0} pending bans, ${joinEventResult.affected || 0} join events, ${channelsDeleted} channels deleted.`;
}

async function teardownRules(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  const configResult = await AppDataSource.getRepository(RulesConfig).delete({
    guildId,
  });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-rules');

  return `Rules torn down: ${configResult.affected || 0} config, ${channelsDeleted} channels deleted.`;
}

async function teardownReactionRoles(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
  // Options are CASCADE deleted when menu is deleted
  const menuResult = await AppDataSource.getRepository(ReactionRoleMenu).delete({ guildId });
  const channelsDeleted = await deleteDevChannels(interaction, 'dev-reaction');

  return `Reaction roles torn down: ${menuResult.affected || 0} menus (+ cascaded options), ${channelsDeleted} channels deleted.`;
}

// ─── Scaffold/Teardown Dispatch Maps ──────────────────────────────────────────

const scaffoldFunctions: Record<
  SystemName,
  (client: Client, interaction: ChatInputCommandInteraction, guildId: string, categoryId: string) => Promise<string>
> = {
  starboard: scaffoldStarboard,
  xp: scaffoldXP,
  onboarding: scaffoldOnboarding,
  events: scaffoldEvents,
  analytics: scaffoldAnalytics,
  sla: scaffoldSLA,
  routing: scaffoldRouting,
  automod: scaffoldAutomod,
  tickets: scaffoldTickets,
  applications: scaffoldApplications,
  announcements: scaffoldAnnouncements,
  memory: scaffoldMemory,
  baitchannel: scaffoldBaitChannel,
  rules: scaffoldRules,
  reactionroles: scaffoldReactionRoles,
};

const teardownFunctions: Record<
  SystemName,
  (client: Client, interaction: ChatInputCommandInteraction, guildId: string) => Promise<string>
> = {
  starboard: teardownStarboard,
  xp: teardownXP,
  onboarding: teardownOnboarding,
  events: teardownEvents,
  analytics: teardownAnalytics,
  sla: teardownSLA,
  routing: teardownRouting,
  automod: teardownAutomod,
  tickets: teardownTickets,
  applications: teardownApplications,
  announcements: teardownAnnouncements,
  memory: teardownMemory,
  baitchannel: teardownBaitChannel,
  rules: teardownRules,
  reactionroles: teardownReactionRoles,
};

const SYSTEM_LABELS: Record<SystemName, string> = {
  starboard: 'Starboard',
  xp: 'XP System',
  onboarding: 'Onboarding',
  events: 'Events',
  analytics: 'Analytics',
  sla: 'Ticket SLA',
  routing: 'Smart Routing',
  automod: 'AutoMod',
  tickets: 'Tickets',
  applications: 'Applications',
  announcements: 'Announcements',
  memory: 'Memory',
  baitchannel: 'Bait Channel',
  rules: 'Rules',
  reactionroles: 'Reaction Roles',
};

// ─── Exported Handlers ────────────────────────────────────────────────────────

export async function handleScaffold(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    const ownerCheck = requireBotOwner(interaction.user.id);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message || '❌ Bot owner only.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const system = interaction.options.getString('system', true) as SystemName;
    const categoryId = await getOrCreateCategory(interaction, guildId);

    const result = await scaffoldFunctions[system](client, interaction, guildId, categoryId);

    const embed = new EmbedBuilder()
      .setTitle(`Scaffold: ${SYSTEM_LABELS[system]}`)
      .setDescription(result)
      .setColor(0x57f287);

    await interaction.editReply({ embeds: [embed] });

    enhancedLogger.info(`Dev scaffold: ${system}`, LogCategory.COMMAND_EXECUTION, {
      guildId,
      system,
      user: interaction.user.id,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'devSuiteScaffold');
  }
}

export async function handleTeardown(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    const ownerCheck = requireBotOwner(interaction.user.id);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message || '❌ Bot owner only.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const system = interaction.options.getString('system', true) as SystemName;

    const result = await teardownFunctions[system](client, interaction, guildId);

    const embed = new EmbedBuilder()
      .setTitle(`Teardown: ${SYSTEM_LABELS[system]}`)
      .setDescription(result)
      .setColor(0xed4245);

    await interaction.editReply({ embeds: [embed] });

    enhancedLogger.info(`Dev teardown: ${system}`, LogCategory.COMMAND_EXECUTION, {
      guildId,
      system,
      user: interaction.user.id,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'devSuiteTeardown');
  }
}

export async function handleScaffoldAll(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    const ownerCheck = requireBotOwner(interaction.user.id);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message || '❌ Bot owner only.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const categoryId = await getOrCreateCategory(interaction, guildId);
    const results: string[] = [];

    for (const system of ALL_SYSTEMS) {
      try {
        const result = await scaffoldFunctions[system](client, interaction, guildId, categoryId);
        results.push(`**${SYSTEM_LABELS[system]}**: ${result.split('\n')[0]}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push(`**${SYSTEM_LABELS[system]}**: Failed -- ${message}`);
        enhancedLogger.error(`Dev scaffold-all failed for ${system}`, error as Error, LogCategory.COMMAND_EXECUTION, {
          guildId,
          system,
        });
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Scaffold All Systems')
      .setDescription(results.join('\n\n'))
      .setColor(0x57f287);

    await interaction.editReply({ embeds: [embed] });

    enhancedLogger.info('Dev scaffold-all complete', LogCategory.COMMAND_EXECUTION, {
      guildId,
      user: interaction.user.id,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'devSuiteScaffoldAll');
  }
}

export async function handleTeardownAll(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  try {
    const ownerCheck = requireBotOwner(interaction.user.id);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message || '❌ Bot owner only.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const results: string[] = [];

    for (const system of ALL_SYSTEMS) {
      try {
        const result = await teardownFunctions[system](client, interaction, guildId);
        results.push(`**${SYSTEM_LABELS[system]}**: ${result}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push(`**${SYSTEM_LABELS[system]}**: Failed -- ${message}`);
        enhancedLogger.error(`Dev teardown-all failed for ${system}`, error as Error, LogCategory.COMMAND_EXECUTION, {
          guildId,
          system,
        });
      }
    }

    // Also try to delete the Dev Testing category if it's now empty
    const guild = interaction.guild!;
    await guild.channels.fetch();
    const devCategory = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildCategory && ch.name === DEV_CATEGORY_NAME,
    );
    if (devCategory) {
      const children = guild.channels.cache.filter(ch => 'parentId' in ch && ch.parentId === devCategory.id);
      if (children.size === 0) {
        try {
          await devCategory.delete('[DEV] Teardown-all cleanup');
          results.push('**Dev Category**: Deleted (was empty).');
        } catch {
          results.push('**Dev Category**: Could not delete.');
        }
      } else {
        results.push(`**Dev Category**: Kept (${children.size} channels still inside).`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Teardown All Systems')
      .setDescription(results.join('\n\n'))
      .setColor(0xed4245);

    await interaction.editReply({ embeds: [embed] });

    enhancedLogger.info('Dev teardown-all complete', LogCategory.COMMAND_EXECUTION, {
      guildId,
      user: interaction.user.id,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'devSuiteTeardownAll');
  }
}
