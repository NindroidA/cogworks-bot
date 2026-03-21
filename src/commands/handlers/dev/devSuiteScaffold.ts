import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../../../typeorm/entities/event/EventTemplate';
import { OnboardingCompletion } from '../../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { StarboardConfig } from '../../../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../../../typeorm/entities/starboard/StarboardEntry';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { XPConfig } from '../../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import {
  enhancedLogger,
  handleInteractionError,
  LogCategory,
  requireBotOwner,
} from '../../../utils';
import type { OnboardingStepDef } from '../../../utils/onboarding/types';

type SystemName =
  | 'starboard'
  | 'xp'
  | 'onboarding'
  | 'events'
  | 'analytics'
  | 'sla'
  | 'routing'
  | 'automod';

const ALL_SYSTEMS: SystemName[] = [
  'starboard',
  'xp',
  'onboarding',
  'events',
  'analytics',
  'sla',
  'routing',
  'automod',
];

const DEV_CATEGORY_NAME = 'Dev Testing';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find or create the dev testing category channel.
 */
async function getOrCreateCategory(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
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
 * Delete all channels whose name starts with the given prefix under any category.
 */
async function deleteDevChannels(
  interaction: ChatInputCommandInteraction,
  prefix: string,
): Promise<number> {
  const guild = interaction.guild!;
  let deleted = 0;

  // Refresh cache
  await guild.channels.fetch();

  const matches = guild.channels.cache.filter(
    ch => ch.type === ChannelType.GuildText && ch.name.startsWith(prefix),
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
  guildId: string,
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

async function teardownXP(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<string> {
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

  if (ticketConfig && ticketConfig.slaEnabled) {
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

  if (ticketConfig && ticketConfig.smartRoutingEnabled) {
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

// ─── Scaffold/Teardown Dispatch Maps ──────────────────────────────────────────

const scaffoldFunctions: Record<
  SystemName,
  (
    client: Client,
    interaction: ChatInputCommandInteraction,
    guildId: string,
    categoryId: string,
  ) => Promise<string>
> = {
  starboard: scaffoldStarboard,
  xp: scaffoldXP,
  onboarding: scaffoldOnboarding,
  events: scaffoldEvents,
  analytics: scaffoldAnalytics,
  sla: scaffoldSLA,
  routing: scaffoldRouting,
  automod: scaffoldAutomod,
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
      .setColor(0x57f287)
      .setTimestamp();

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
      .setColor(0xed4245)
      .setTimestamp();

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
        enhancedLogger.error(
          `Dev scaffold-all failed for ${system}`,
          error as Error,
          LogCategory.COMMAND_EXECUTION,
          { guildId, system },
        );
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Scaffold All Systems')
      .setDescription(results.join('\n\n'))
      .setColor(0x57f287)
      .setTimestamp();

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
        enhancedLogger.error(
          `Dev teardown-all failed for ${system}`,
          error as Error,
          LogCategory.COMMAND_EXECUTION,
          { guildId, system },
        );
      }
    }

    // Also try to delete the Dev Testing category if it's now empty
    const guild = interaction.guild!;
    await guild.channels.fetch();
    const devCategory = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildCategory && ch.name === DEV_CATEGORY_NAME,
    );
    if (devCategory) {
      const children = guild.channels.cache.filter(
        ch => 'parentId' in ch && ch.parentId === devCategory.id,
      );
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
      .setColor(0xed4245)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    enhancedLogger.info('Dev teardown-all complete', LogCategory.COMMAND_EXECUTION, {
      guildId,
      user: interaction.user.id,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'devSuiteTeardownAll');
  }
}
