import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const devSuite = new SlashCommandBuilder()
  .setName('dev-suite')
  .setDescription('Dev testing workflows & automation (bot owner only)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // ─── Scaffold / Teardown ──────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName('scaffold')
      .setDescription('Set up a system with test-friendly defaults and auto-created channels')
      .addStringOption(opt =>
        opt
          .setName('system')
          .setDescription('System to scaffold')
          .setRequired(true)
          .addChoices(
            { name: 'Tickets', value: 'tickets' },
            { name: 'Applications', value: 'applications' },
            { name: 'Announcements', value: 'announcements' },
            { name: 'Memory', value: 'memory' },
            { name: 'Bait Channel', value: 'baitchannel' },
            { name: 'Rules', value: 'rules' },
            { name: 'Reaction Roles', value: 'reactionroles' },
            { name: 'Starboard', value: 'starboard' },
            { name: 'XP System', value: 'xp' },
            { name: 'Onboarding', value: 'onboarding' },
            { name: 'Events', value: 'events' },
            { name: 'Analytics', value: 'analytics' },
            { name: 'Ticket SLA', value: 'sla' },
            { name: 'Smart Routing', value: 'routing' },
            { name: 'AutoMod', value: 'automod' },
          ),
      )
      .addChannelOption(opt =>
        opt
          .setName('category')
          .setDescription('Category for auto-created channels (default: creates one)')
          .addChannelTypes(ChannelType.GuildCategory),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('teardown')
      .setDescription('Remove config, data, and dev channels for a system')
      .addStringOption(opt =>
        opt
          .setName('system')
          .setDescription('System to tear down')
          .setRequired(true)
          .addChoices(
            { name: 'Tickets', value: 'tickets' },
            { name: 'Applications', value: 'applications' },
            { name: 'Announcements', value: 'announcements' },
            { name: 'Memory', value: 'memory' },
            { name: 'Bait Channel', value: 'baitchannel' },
            { name: 'Rules', value: 'rules' },
            { name: 'Reaction Roles', value: 'reactionroles' },
            { name: 'Starboard', value: 'starboard' },
            { name: 'XP System', value: 'xp' },
            { name: 'Onboarding', value: 'onboarding' },
            { name: 'Events', value: 'events' },
            { name: 'Analytics', value: 'analytics' },
            { name: 'Ticket SLA', value: 'sla' },
            { name: 'Smart Routing', value: 'routing' },
            { name: 'AutoMod', value: 'automod' },
          ),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('scaffold-all')
      .setDescription('Scaffold ALL systems at once for full integration testing')
      .addChannelOption(opt =>
        opt
          .setName('category')
          .setDescription('Category for auto-created channels')
          .addChannelTypes(ChannelType.GuildCategory),
      ),
  )
  .addSubcommand(sub =>
    sub.setName('teardown-all').setDescription('Factory reset — remove all test configs, data, and dev channels'),
  )

  // ─── Automated Testing ────────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub.setName('smoke-test').setDescription('Quick health check — reports config status for every system'),
  )
  .addSubcommand(sub =>
    sub
      .setName('regression')
      .setDescription('Write/read/delete test data for every system — verify data layer integrity'),
  )
  .addSubcommand(sub =>
    sub.setName('permissions-audit').setDescription('Verify all admin-only commands properly reject non-admin users'),
  )
  .addSubcommand(sub =>
    sub
      .setName('master-test')
      .setDescription('Full test suite — scaffold, populate, smoke-test, regression, then teardown'),
  )

  // ─── Data & Simulation ───────────────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName('populate')
      .setDescription('Seed realistic usage data as if the system ran for weeks')
      .addStringOption(opt =>
        opt
          .setName('system')
          .setDescription('System to populate (or "all")')
          .setRequired(true)
          .addChoices(
            { name: 'All Systems', value: 'all' },
            { name: 'Tickets (archives)', value: 'tickets' },
            { name: 'Applications (archives)', value: 'applications' },
            { name: 'Memory (items)', value: 'memory' },
            { name: 'Bait Channel (logs)', value: 'baitchannel' },
            { name: 'Announcements (logs)', value: 'announcements' },
            { name: 'Starboard', value: 'starboard' },
            { name: 'XP System', value: 'xp' },
            { name: 'Analytics', value: 'analytics' },
            { name: 'Events', value: 'events' },
            { name: 'Onboarding', value: 'onboarding' },
            { name: 'SLA', value: 'sla' },
          ),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('timeline')
      .setDescription('Fast-forward — compress hours of activity into minutes')
      .addStringOption(opt =>
        opt
          .setName('system')
          .setDescription('System to simulate')
          .setRequired(true)
          .addChoices(
            { name: 'XP System', value: 'xp' },
            { name: 'Analytics', value: 'analytics' },
            { name: 'SLA', value: 'sla' },
          ),
      )
      .addIntegerOption(opt =>
        opt
          .setName('minutes')
          .setDescription('How many minutes to run the simulation (default: 2)')
          .setMinValue(1)
          .setMaxValue(10),
      ),
  )

  // ─── Guided & Integration Testing ────────────────────────────────────────
  .addSubcommand(sub =>
    sub
      .setName('walkthrough')
      .setDescription('Guided step-by-step testing flow with interactive buttons')
      .addStringOption(opt =>
        opt
          .setName('system')
          .setDescription('System to walk through')
          .setRequired(true)
          .addChoices(
            { name: 'Starboard', value: 'starboard' },
            { name: 'XP System', value: 'xp' },
            { name: 'Onboarding', value: 'onboarding' },
            { name: 'Events', value: 'events' },
            { name: 'Analytics', value: 'analytics' },
            { name: 'Ticket SLA', value: 'sla' },
          ),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('chain')
      .setDescription('Test cross-system integration scenarios')
      .addStringOption(opt =>
        opt
          .setName('scenario')
          .setDescription('Integration scenario to test')
          .setRequired(true)
          .addChoices(
            { name: 'XP + Starboard', value: 'xp-starboard' },
            { name: 'Onboarding + XP', value: 'onboarding-xp' },
            { name: 'Tickets + SLA + Routing', value: 'tickets-sla-routing' },
            { name: 'Analytics + XP', value: 'analytics-xp' },
          ),
      ),
  );
