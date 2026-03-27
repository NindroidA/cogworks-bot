import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const devTest = new SlashCommandBuilder()
  .setName('dev-test')
  .setDescription('Dev testing commands for new v3 features (bot owner only)')
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // Starboard testing
  .addSubcommand(sub =>
    sub
      .setName('starboard-simulate')
      .setDescription('Simulate stars on a message (bypasses reaction requirement)')
      .addStringOption(opt => opt.setName('message-id').setDescription('Message ID to star').setRequired(true))
      .addIntegerOption(opt =>
        opt.setName('count').setDescription('Star count to simulate (default: 5)').setMinValue(1).setMaxValue(100),
      ),
  )

  // XP testing
  .addSubcommand(sub =>
    sub
      .setName('xp-grant')
      .setDescription('Grant XP to a user (bypass cooldown)')
      .addUserOption(opt => opt.setName('user').setDescription('User to grant XP').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('XP amount').setRequired(true).setMinValue(1)),
  )
  .addSubcommand(sub =>
    sub
      .setName('xp-force-levelup')
      .setDescription('Force a user to the next level')
      .addUserOption(opt => opt.setName('user').setDescription('User to level up').setRequired(true)),
  )
  .addSubcommand(sub =>
    sub
      .setName('xp-simulate-voice')
      .setDescription('Simulate voice XP for a user (as if they were in voice for N minutes)')
      .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption(opt =>
        opt.setName('minutes').setDescription('Minutes of voice to simulate').setRequired(true).setMinValue(1),
      ),
  )

  // SLA testing
  .addSubcommand(sub =>
    sub.setName('sla-force-check').setDescription('Force an immediate SLA breach check (normally runs hourly)'),
  )
  .addSubcommand(sub =>
    sub
      .setName('sla-backdate-ticket')
      .setDescription('Backdate a ticket creation time to simulate SLA breach')
      .addIntegerOption(opt => opt.setName('ticket-id').setDescription('Ticket ID to backdate').setRequired(true))
      .addIntegerOption(opt =>
        opt
          .setName('minutes-ago')
          .setDescription('How many minutes ago to set the creation time')
          .setRequired(true)
          .setMinValue(1),
      ),
  )

  // Onboarding testing
  .addSubcommand(sub =>
    sub
      .setName('onboarding-trigger')
      .setDescription('Trigger the onboarding flow for yourself (simulates new member join)'),
  )

  // Analytics testing
  .addSubcommand(sub =>
    sub
      .setName('analytics-flush')
      .setDescription('Force flush analytics counters to snapshot (normally runs daily at midnight)'),
  )
  .addSubcommand(sub =>
    sub
      .setName('analytics-seed')
      .setDescription('Seed 30 days of fake analytics data for testing charts')
      .addIntegerOption(opt =>
        opt.setName('days').setDescription('Number of days to seed (default: 30)').setMinValue(1).setMaxValue(90),
      ),
  )

  // Event reminder testing
  .addSubcommand(sub =>
    sub
      .setName('reminder-force-check')
      .setDescription('Force an immediate event reminder check (normally runs hourly)'),
  )

  // Smart routing testing
  .addSubcommand(sub =>
    sub
      .setName('routing-simulate')
      .setDescription('Simulate ticket routing without creating a ticket')
      .addStringOption(opt => opt.setName('ticket-type').setDescription('Ticket type ID to route').setRequired(true)),
  )

  // Import testing
  .addSubcommand(sub =>
    sub
      .setName('import-seed-xp')
      .setDescription('Seed fake XP data for 10 test users (for testing leaderboard/rank)')
      .addIntegerOption(opt =>
        opt.setName('count').setDescription('Number of users to seed (default: 10)').setMinValue(1).setMaxValue(50),
      ),
  )

  // Status testing
  .addSubcommand(sub =>
    sub
      .setName('status-create-incident')
      .setDescription('Create a test status incident')
      .addStringOption(opt =>
        opt
          .setName('level')
          .setDescription('Incident level')
          .setRequired(true)
          .addChoices(
            { name: 'Degraded', value: 'degraded' },
            { name: 'Partial Outage', value: 'partial-outage' },
            { name: 'Major Outage', value: 'major-outage' },
            { name: 'Maintenance', value: 'maintenance' },
          ),
      )
      .addStringOption(opt => opt.setName('message').setDescription('Incident message').setRequired(true)),
  )

  // Cleanup
  .addSubcommand(sub =>
    sub.setName('cleanup-test-data').setDescription('Remove all test/seeded data created by dev-test commands'),
  );
