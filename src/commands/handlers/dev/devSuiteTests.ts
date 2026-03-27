/**
 * Dev Suite — Automated Testing Commands
 *
 * Provides smoke tests, regression tests, permissions audits, and a master
 * test runner that orchestrates them all. Bot owner only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import type { AppDataSource } from '../../../typeorm';
import { AnalyticsConfig } from '../../../typeorm/entities/analytics/AnalyticsConfig';
import { AnalyticsSnapshot } from '../../../typeorm/entities/analytics/AnalyticsSnapshot';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { EventConfig } from '../../../typeorm/entities/event/EventConfig';
import { EventReminder } from '../../../typeorm/entities/event/EventReminder';
import { EventTemplate } from '../../../typeorm/entities/event/EventTemplate';
import { ImportLog } from '../../../typeorm/entities/import/ImportLog';
import { OnboardingCompletion } from '../../../typeorm/entities/onboarding/OnboardingCompletion';
import { OnboardingConfig } from '../../../typeorm/entities/onboarding/OnboardingConfig';
import { StarboardConfig } from '../../../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../../../typeorm/entities/starboard/StarboardEntry';
import { StatusIncident } from '../../../typeorm/entities/status/StatusIncident';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { XPConfig } from '../../../typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { enhancedLogger, LogCategory } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SystemStatus {
  name: string;
  status: 'configured' | 'not_configured';
  enabled: boolean;
  details: string;
  issues: string[];
}

interface RegressionResult {
  system: string;
  passed: boolean;
  details: string;
}

interface PermissionAuditResult {
  file: string;
  handler: string;
  hasPermissionCheck: boolean;
  checkType: string | null;
}

interface MasterTestResult {
  phase: string;
  passed: number;
  failed: number;
  warnings: number;
  details: string[];
}

// ─── Repository Accessors ───────────────────────────────────────────────────

const starboardConfigRepo = lazyRepo(StarboardConfig);
const starboardEntryRepo = lazyRepo(StarboardEntry);
const xpConfigRepo = lazyRepo(XPConfig);
const xpUserRepo = lazyRepo(XPUser);
const xpRoleRewardRepo = lazyRepo(XPRoleReward);
const onboardingConfigRepo = lazyRepo(OnboardingConfig);
const onboardingCompletionRepo = lazyRepo(OnboardingCompletion);
const eventConfigRepo = lazyRepo(EventConfig);
const eventTemplateRepo = lazyRepo(EventTemplate);
const eventReminderRepo = lazyRepo(EventReminder);
const analyticsConfigRepo = lazyRepo(AnalyticsConfig);
const analyticsSnapshotRepo = lazyRepo(AnalyticsSnapshot);
const importLogRepo = lazyRepo(ImportLog);
const statusIncidentRepo = lazyRepo(StatusIncident);
const ticketConfigRepo = lazyRepo(TicketConfig);
const applicationConfigRepo = lazyRepo(ApplicationConfig);

// ─── Smoke Test ─────────────────────────────────────────────────────────────

async function runSmokeTest(client: Client, guildId: string): Promise<SystemStatus[]> {
  const results: SystemStatus[] = [];

  // Helper to verify a channel still exists and is accessible
  async function channelExists(channelId: string | null): Promise<boolean> {
    if (!channelId) return false;
    try {
      const ch = await client.channels.fetch(channelId);
      return ch !== null;
    } catch {
      return false;
    }
  }

  // 1. Starboard
  const starboardConfig = await starboardConfigRepo.findOneBy({ guildId });
  if (starboardConfig) {
    const entryCount = await starboardEntryRepo.count({ where: { guildId } });
    const issues: string[] = [];
    const chOk = await channelExists(starboardConfig.channelId);
    if (!chOk) issues.push('Starboard channel not accessible');
    results.push({
      name: 'Starboard',
      status: 'configured',
      enabled: starboardConfig.enabled,
      details: `channel ${chOk ? 'exists' : 'missing'}, ${entryCount} entries`,
      issues,
    });
  } else {
    results.push({
      name: 'Starboard',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
  }

  // 2. XP System
  const xpConfig = await xpConfigRepo.findOneBy({ guildId });
  if (xpConfig) {
    const userCount = await xpUserRepo.count({ where: { guildId } });
    const rewardCount = await xpRoleRewardRepo.count({ where: { guildId } });
    const issues: string[] = [];
    if (xpConfig.levelUpChannelId) {
      const chOk = await channelExists(xpConfig.levelUpChannelId);
      if (!chOk) issues.push('Level-up channel not accessible');
    }
    results.push({
      name: 'XP System',
      status: 'configured',
      enabled: xpConfig.enabled,
      details: `${userCount} users, ${rewardCount} role rewards`,
      issues,
    });
  } else {
    results.push({
      name: 'XP System',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
  }

  // 3. Onboarding
  const onboardingConfig = await onboardingConfigRepo.findOneBy({ guildId });
  if (onboardingConfig) {
    const stepCount = onboardingConfig.steps?.length ?? 0;
    const issues: string[] = [];
    if (stepCount === 0) issues.push('0 steps configured');
    results.push({
      name: 'Onboarding',
      status: 'configured',
      enabled: onboardingConfig.enabled,
      details: `${stepCount} steps`,
      issues,
    });
  } else {
    results.push({
      name: 'Onboarding',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
  }

  // 4. Events
  const eventConfig = await eventConfigRepo.findOneBy({ guildId });
  if (eventConfig) {
    const templateCount = await eventTemplateRepo.count({
      where: { guildId },
    });
    const issues: string[] = [];
    if (eventConfig.reminderChannelId) {
      const chOk = await channelExists(eventConfig.reminderChannelId);
      if (!chOk) issues.push('Reminder channel not accessible');
    }
    if (eventConfig.summaryChannelId) {
      const chOk = await channelExists(eventConfig.summaryChannelId);
      if (!chOk) issues.push('Summary channel not accessible');
    }
    results.push({
      name: 'Events',
      status: 'configured',
      enabled: eventConfig.enabled,
      details: `${templateCount} templates`,
      issues,
    });
  } else {
    results.push({
      name: 'Events',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
  }

  // 5. Analytics
  const analyticsConfig = await analyticsConfigRepo.findOneBy({ guildId });
  if (analyticsConfig) {
    const snapshotCount = await analyticsSnapshotRepo.count({
      where: { guildId },
    });
    const issues: string[] = [];
    if (analyticsConfig.digestChannelId) {
      const chOk = await channelExists(analyticsConfig.digestChannelId);
      if (!chOk) issues.push('Digest channel not accessible');
    }
    results.push({
      name: 'Analytics',
      status: 'configured',
      enabled: analyticsConfig.enabled,
      details: `${snapshotCount} snapshots`,
      issues,
    });
  } else {
    results.push({
      name: 'Analytics',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
  }

  // 6. SLA (part of TicketConfig)
  const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
  if (ticketConfig) {
    const issues: string[] = [];
    if (ticketConfig.slaEnabled && ticketConfig.slaBreachChannelId) {
      const chOk = await channelExists(ticketConfig.slaBreachChannelId);
      if (!chOk) issues.push('SLA breach channel not accessible');
    }
    results.push({
      name: 'SLA',
      status: 'configured',
      enabled: ticketConfig.slaEnabled,
      details: ticketConfig.slaEnabled ? `target: ${ticketConfig.slaTargetMinutes}min` : '',
      issues,
    });

    // 7. Routing (part of TicketConfig)
    const ruleCount = ticketConfig.routingRules?.length ?? 0;
    results.push({
      name: 'Routing',
      status: ticketConfig.routingRules ? 'configured' : 'not_configured',
      enabled: ticketConfig.smartRoutingEnabled,
      details: ticketConfig.smartRoutingEnabled ? `${ruleCount} rules, strategy: ${ticketConfig.routingStrategy}` : '',
      issues: [],
    });
  } else {
    results.push({
      name: 'SLA',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
    results.push({
      name: 'Routing',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
  }

  // 8. Application Workflow
  const appConfig = await applicationConfigRepo.findOneBy({ guildId });
  if (appConfig) {
    results.push({
      name: 'App Workflow',
      status: 'configured',
      enabled: appConfig.enableWorkflow,
      details: appConfig.enableWorkflow ? `${appConfig.workflowStatuses?.length ?? 0} statuses` : '',
      issues: [],
    });
  } else {
    results.push({
      name: 'App Workflow',
      status: 'not_configured',
      enabled: false,
      details: '',
      issues: [],
    });
  }

  // 9. AutoMod (no DB entity — rules stored on Discord's side)
  try {
    const guild = client.guilds.cache.find(g => g.id === guildId);
    if (guild) {
      const rules = await guild.autoModerationRules.fetch();
      results.push({
        name: 'AutoMod',
        status: 'configured',
        enabled: true,
        details: `${rules.size} rules (Discord-managed, no DB)`,
        issues: [],
      });
    } else {
      results.push({
        name: 'AutoMod',
        status: 'configured',
        enabled: true,
        details: 'Discord-managed, no DB entity',
        issues: [],
      });
    }
  } catch {
    results.push({
      name: 'AutoMod',
      status: 'configured',
      enabled: true,
      details: 'Discord-managed, no DB entity',
      issues: [],
    });
  }

  return results;
}

function formatSmokeEmbed(results: SystemStatus[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Smoke Test Results')
    .setColor(
      results.some(r => r.issues.length > 0)
        ? 0xffaa00
        : results.every(r => r.status === 'not_configured')
          ? 0xff0000
          : 0x00ff00,
    );

  for (const r of results) {
    let icon: string;
    if (r.status === 'not_configured') {
      icon = '\u274C'; // red X
    } else if (r.issues.length > 0) {
      icon = '\u26A0\uFE0F'; // warning
    } else if (r.enabled) {
      icon = '\u2705'; // green check
    } else {
      icon = '\u26A0\uFE0F Configured but disabled';
    }

    let value: string;
    if (r.status === 'not_configured') {
      value = 'Not configured';
    } else {
      const parts = [r.enabled ? 'Enabled' : 'Disabled'];
      if (r.details) parts.push(`(${r.details})`);
      if (r.issues.length > 0) {
        parts.push(`\nIssues: ${r.issues.join(', ')}`);
      }
      value = parts.join(' ');
    }

    embed.addFields({
      name: `${icon} ${r.name}`,
      value,
      inline: false,
    });
  }

  return embed;
}

export async function handleSmokeTest(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const results = await runSmokeTest(client, guildId);
  const embed = formatSmokeEmbed(results);

  await interaction.editReply({ embeds: [embed] });
}

// ─── Regression Test ────────────────────────────────────────────────────────

const TEST_GUILD_ID = 'test-regression-000';

async function runRegressionTests(): Promise<RegressionResult[]> {
  const results: RegressionResult[] = [];

  // Helper for write -> read -> verify -> delete cycle
  async function testEntity<T extends { id?: number }>(
    systemName: string,
    repo: ReturnType<typeof AppDataSource.getRepository<any>>,
    createData: Record<string, unknown>,
    verifyFields: string[],
  ): Promise<RegressionResult> {
    try {
      // Write
      const entity = repo.create(createData);
      const saved = await repo.save(entity);
      const savedId = (saved as T & { id: number }).id;

      // Read
      const found = await repo.findOneBy({ id: savedId });
      if (!found) {
        // Cleanup just in case
        await repo.delete({ id: savedId }).catch(() => {});
        return {
          system: systemName,
          passed: false,
          details: 'Read-back returned null',
        };
      }

      // Verify
      const mismatches: string[] = [];
      for (const field of verifyFields) {
        const expected = createData[field];
        const actual = (found as Record<string, unknown>)[field];

        // Handle JSON columns — compare serialized forms
        const expectedStr = JSON.stringify(expected);
        const actualStr = JSON.stringify(actual);

        if (expectedStr !== actualStr) {
          mismatches.push(`${field}: expected ${expectedStr}, got ${actualStr}`);
        }
      }

      // Delete
      await repo.delete({ id: savedId });

      // Verify deletion
      const afterDelete = await repo.findOneBy({ id: savedId });
      if (afterDelete) {
        mismatches.push('Entity still exists after deletion');
      }

      if (mismatches.length > 0) {
        return {
          system: systemName,
          passed: false,
          details: mismatches.join('; '),
        };
      }

      return {
        system: systemName,
        passed: true,
        details: 'Write/read/verify/delete OK',
      };
    } catch (error) {
      return {
        system: systemName,
        passed: false,
        details: `Error: ${(error as Error).message}`,
      };
    }
  }

  // 1. StarboardConfig
  results.push(
    await testEntity(
      'StarboardConfig',
      starboardConfigRepo,
      {
        guildId: TEST_GUILD_ID,
        enabled: true,
        channelId: '000000000000000001',
        emoji: '\u2B50',
        threshold: 5,
        selfStar: false,
        ignoredChannels: ['111', '222'],
        ignoreBots: true,
        ignoreNSFW: false,
      },
      ['guildId', 'enabled', 'channelId', 'emoji', 'threshold', 'selfStar', 'ignoredChannels', 'ignoreBots'],
    ),
  );

  // 2. StarboardEntry
  results.push(
    await testEntity(
      'StarboardEntry',
      starboardEntryRepo,
      {
        guildId: TEST_GUILD_ID,
        originalMessageId: '000000000000000002',
        originalChannelId: '000000000000000003',
        authorId: '000000000000000004',
        starboardMessageId: '000000000000000005',
        starCount: 7,
        content: 'Test starboard content',
        attachmentUrl: null,
      },
      ['guildId', 'originalMessageId', 'starCount', 'content'],
    ),
  );

  // 3. XPConfig (with simple-json column)
  results.push(
    await testEntity(
      'XPConfig',
      xpConfigRepo,
      {
        guildId: TEST_GUILD_ID,
        enabled: true,
        xpPerMessageMin: 10,
        xpPerMessageMax: 30,
        xpCooldownSeconds: 45,
        xpPerVoiceMinute: 8,
        voiceXpEnabled: true,
        levelUpChannelId: null,
        multiplierChannels: { '123': 2, '456': 3 },
        stackMultipliers: true,
      },
      ['guildId', 'enabled', 'xpPerMessageMin', 'xpPerMessageMax', 'multiplierChannels', 'stackMultipliers'],
    ),
  );

  // 4. XPUser
  results.push(
    await testEntity(
      'XPUser',
      xpUserRepo,
      {
        guildId: TEST_GUILD_ID,
        userId: '000000000000000006',
        xp: 12345,
        level: 15,
        messages: 500,
        voiceMinutes: 120,
      },
      ['guildId', 'userId', 'xp', 'level', 'messages', 'voiceMinutes'],
    ),
  );

  // 5. XPRoleReward
  results.push(
    await testEntity(
      'XPRoleReward',
      xpRoleRewardRepo,
      {
        guildId: TEST_GUILD_ID,
        level: 10,
        roleId: '000000000000000007',
        removeOnDelevel: true,
      },
      ['guildId', 'level', 'roleId', 'removeOnDelevel'],
    ),
  );

  // 6. OnboardingConfig (with simple-json column)
  results.push(
    await testEntity(
      'OnboardingConfig',
      onboardingConfigRepo,
      {
        guildId: TEST_GUILD_ID,
        enabled: true,
        welcomeMessage: 'Welcome to {server}!',
        steps: [{ type: 'message', content: 'Step 1' }],
        completionRoleId: '000000000000000008',
        trackCompletionRate: true,
      },
      ['guildId', 'enabled', 'welcomeMessage', 'steps', 'completionRoleId'],
    ),
  );

  // 7. OnboardingCompletion (with simple-json column)
  results.push(
    await testEntity(
      'OnboardingCompletion',
      onboardingCompletionRepo,
      {
        guildId: TEST_GUILD_ID,
        userId: '000000000000000009',
        completedSteps: ['step-1', 'step-2'],
        completedAt: null,
      },
      ['guildId', 'userId', 'completedSteps'],
    ),
  );

  // 8. EventConfig
  results.push(
    await testEntity(
      'EventConfig',
      eventConfigRepo,
      {
        guildId: TEST_GUILD_ID,
        enabled: true,
        reminderChannelId: '000000000000000010',
        defaultReminderMinutes: 15,
        postEventSummary: true,
        summaryChannelId: '000000000000000011',
      },
      ['guildId', 'enabled', 'reminderChannelId', 'defaultReminderMinutes', 'postEventSummary'],
    ),
  );

  // 9. EventTemplate (with varchar columns)
  results.push(
    await testEntity(
      'EventTemplate',
      eventTemplateRepo,
      {
        guildId: TEST_GUILD_ID,
        name: 'test-regression-template',
        title: 'Regression Test Event',
        description: 'A test event template',
        location: 'Test Location',
        entityType: 'external',
        defaultDurationMinutes: 90,
        isRecurring: true,
        recurringPattern: 'weekly',
        createdBy: '000000000000000012',
      },
      ['guildId', 'name', 'title', 'description', 'entityType', 'isRecurring', 'recurringPattern'],
    ),
  );

  // 10. EventReminder
  const futureDate = new Date(Date.now() + 86400000);
  results.push(
    await testEntity(
      'EventReminder',
      eventReminderRepo,
      {
        guildId: TEST_GUILD_ID,
        discordEventId: '000000000000000013',
        reminderAt: futureDate,
        sent: false,
        eventTitle: 'Regression Reminder',
      },
      ['guildId', 'discordEventId', 'sent', 'eventTitle'],
    ),
  );

  // 11. AnalyticsConfig
  results.push(
    await testEntity(
      'AnalyticsConfig',
      analyticsConfigRepo,
      {
        guildId: TEST_GUILD_ID,
        enabled: true,
        digestChannelId: '000000000000000014',
        digestFrequency: 'both',
        digestDay: 5,
      },
      ['guildId', 'enabled', 'digestChannelId', 'digestFrequency', 'digestDay'],
    ),
  );

  // 12. AnalyticsSnapshot (with simple-json column)
  results.push(
    await testEntity(
      'AnalyticsSnapshot',
      analyticsSnapshotRepo,
      {
        guildId: TEST_GUILD_ID,
        date: new Date('2026-01-01'),
        memberCount: 150,
        memberJoined: 5,
        memberLeft: 2,
        messageCount: 300,
        activeMembers: 40,
        voiceMinutes: 120,
        topChannels: [{ channelId: '1', name: 'general', count: 100 }],
        peakHourUtc: 14,
      },
      ['guildId', 'memberCount', 'memberJoined', 'messageCount', 'topChannels', 'peakHourUtc'],
    ),
  );

  // 13. ImportLog (with simple-json column)
  results.push(
    await testEntity(
      'ImportLog',
      importLogRepo,
      {
        guildId: TEST_GUILD_ID,
        source: 'mee6',
        dataType: 'xp',
        importedCount: 50,
        skippedCount: 3,
        failedCount: 1,
        errors: ['Row 5: invalid xp value'],
        triggeredBy: '000000000000000015',
        status: 'completed',
        durationMs: 1234,
      },
      ['guildId', 'source', 'dataType', 'importedCount', 'errors', 'status'],
    ),
  );

  // 14. StatusIncident (with simple-json column)
  results.push(
    await testEntity(
      'StatusIncident',
      statusIncidentRepo,
      {
        level: 'degraded',
        message: 'Regression test incident',
        affectedSystems: ['api', 'database'],
      },
      ['level', 'message', 'affectedSystems'],
    ),
  );

  return results;
}

function formatRegressionEmbed(results: RegressionResult[]): EmbedBuilder {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  const embed = new EmbedBuilder()
    .setTitle('Regression Test Results')
    .setDescription(`**${passed}** passed, **${failed}** failed`)
    .setColor(failed > 0 ? 0xff0000 : 0x00ff00);

  for (const r of results) {
    embed.addFields({
      name: `${r.passed ? '\u2705' : '\u274C'} ${r.system}`,
      value: r.details,
      inline: false,
    });
  }

  return embed;
}

export async function handleRegression(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const results = await runRegressionTests();
  const embed = formatRegressionEmbed(results);

  await interaction.editReply({ embeds: [embed] });
}

// ─── Permissions Audit ──────────────────────────────────────────────────────

/** Handler directories and files to audit for permission checks */
const AUDIT_TARGETS: { dir: string; label: string; fileFilter?: string }[] = [
  { dir: 'starboard', label: 'Starboard' },
  { dir: 'xp', label: 'XP' },
  { dir: 'onboarding', label: 'Onboarding' },
  { dir: 'automod', label: 'Automod' },
  { dir: 'event', label: 'Event' },
  { dir: 'insights', label: 'Insights' },
  { dir: 'import', label: 'Import' },
  { dir: 'ticket', label: 'Ticket SLA', fileFilter: 'sla' },
  { dir: 'ticket', label: 'Ticket Routing', fileFilter: 'routing' },
  { dir: 'application', label: 'App Workflow', fileFilter: 'workflow' },
];

/**
 * Files that are intentionally public (no admin check required).
 * These are read-only query commands that all users should be able to run.
 * The audit will mark these as PASS (intentionally public) instead of WARNING.
 */
const INTENTIONALLY_PUBLIC: Set<string> = new Set([
  // Starboard — viewing stats and random entries is public
  'random',
  'stats',
  // XP — rank and leaderboard are public, index is a router
  'rank',
  'leaderboard',
  // Insights — viewing analytics is public (setup is admin)
  'overview',
  'growth',
  'channels',
  'hours',
  // Index/router files dispatch to other handlers that have their own checks
  'index',
]);

async function runPermissionsAudit(): Promise<PermissionAuditResult[]> {
  const results: PermissionAuditResult[] = [];
  const handlersBase = path.resolve(__dirname, '..');

  for (const target of AUDIT_TARGETS) {
    const targetPath = path.resolve(handlersBase, target.dir);

    try {
      const stat = fs.statSync(targetPath);

      if (stat.isDirectory()) {
        let files = fs.readdirSync(targetPath).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
        if (target.fileFilter) {
          files = files.filter(f => f.startsWith(target.fileFilter!));
        }

        // Check if the router/index file has an admin check — if so, all files
        // in this directory are covered by the router's gate
        let routerHasAdminGate = false;
        const indexFile = files.find(f => f.startsWith('index.') && !target.fileFilter);
        if (indexFile) {
          const indexContent = fs.readFileSync(path.join(targetPath, indexFile), 'utf-8');
          routerHasAdminGate = indexContent.includes('requireAdmin') || indexContent.includes('requireBotOwner');
        }

        for (const file of files) {
          const filePath = path.join(targetPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const hasAdmin = content.includes('requireAdmin');
          const hasOwner = content.includes('requireBotOwner');

          let checkType: string | null = null;
          if (hasAdmin && hasOwner) checkType = 'requireAdmin + requireBotOwner';
          else if (hasAdmin) checkType = 'requireAdmin';
          else if (hasOwner) checkType = 'requireBotOwner';

          const baseName = file.replace(/\.(ts|js)$/, '');
          const isPublic = INTENTIONALLY_PUBLIC.has(baseName);
          const coveredByRouter = routerHasAdminGate && !hasAdmin && !hasOwner && !isPublic;

          if (isPublic && !hasAdmin && !hasOwner) {
            checkType = 'intentionally public';
          } else if (coveredByRouter) {
            checkType = 'covered by router admin gate';
          }

          results.push({
            file: `${target.label}/${file}`,
            handler: target.label,
            hasPermissionCheck: hasAdmin || hasOwner || isPublic || coveredByRouter,
            checkType: checkType || (isPublic ? 'intentionally public' : null),
          });
        }
      } else if (stat.isFile()) {
        // Single file target
        const content = fs.readFileSync(targetPath, 'utf-8');
        const hasAdmin = content.includes('requireAdmin');
        const hasOwner = content.includes('requireBotOwner');

        let checkType: string | null = null;
        if (hasAdmin && hasOwner) checkType = 'requireAdmin + requireBotOwner';
        else if (hasAdmin) checkType = 'requireAdmin';
        else if (hasOwner) checkType = 'requireBotOwner';

        results.push({
          file: target.label,
          handler: target.label,
          hasPermissionCheck: hasAdmin || hasOwner,
          checkType,
        });
      }
    } catch {
      results.push({
        file: target.label,
        handler: target.label,
        hasPermissionCheck: false,
        checkType: null,
      });
    }
  }

  return results;
}

function formatPermissionsEmbed(results: PermissionAuditResult[]): EmbedBuilder {
  const withCheck = results.filter(r => r.hasPermissionCheck).length;
  const withoutCheck = results.filter(r => !r.hasPermissionCheck).length;

  const embed = new EmbedBuilder()
    .setTitle('Permissions Audit Results')
    .setDescription(`**${withCheck}** with checks, **${withoutCheck}** without checks`)
    .setColor(withoutCheck > 0 ? 0xffaa00 : 0x00ff00);

  // Group by handler
  const grouped = new Map<string, PermissionAuditResult[]>();
  for (const r of results) {
    const existing = grouped.get(r.handler) ?? [];
    existing.push(r);
    grouped.set(r.handler, existing);
  }

  for (const [handler, handlerResults] of grouped) {
    const lines = handlerResults.map(r => {
      const icon = r.hasPermissionCheck ? '\u2705' : '\u274C';
      const check = r.checkType ? ` (${r.checkType})` : '';
      const fileName = r.file.includes('/') ? r.file.split('/').pop() : r.file;
      return `${icon} ${fileName}${check}`;
    });

    embed.addFields({
      name: handler,
      value: lines.join('\n') || 'No files found',
      inline: false,
    });
  }

  return embed;
}

export async function handlePermissionsAudit(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const results = await runPermissionsAudit();
  const embed = formatPermissionsEmbed(results);

  await interaction.editReply({ embeds: [embed] });
}

// ─── Master Test ────────────────────────────────────────────────────────────

export async function handleMasterTest(
  client: Client,
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const masterResults: MasterTestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalWarnings = 0;

  // Dynamic imports for scaffold/teardown/populate
  let handleScaffoldAll:
    | ((client: Client, interaction: ChatInputCommandInteraction, guildId: string) => Promise<void>)
    | undefined;
  let handleTeardownAll:
    | ((client: Client, interaction: ChatInputCommandInteraction, guildId: string) => Promise<void>)
    | undefined;
  let handlePopulate:
    | ((client: Client, interaction: ChatInputCommandInteraction, guildId: string) => Promise<void>)
    | undefined;

  try {
    const scaffoldMod = await import('./devSuiteScaffold');
    handleScaffoldAll = scaffoldMod.handleScaffoldAll;
    handleTeardownAll = scaffoldMod.handleTeardownAll;
  } catch {
    enhancedLogger.warn(
      'devSuiteScaffold not available, skipping scaffold/teardown phases',
      LogCategory.COMMAND_EXECUTION,
    );
  }

  try {
    const workflowsMod = await import('./devSuiteWorkflows');
    handlePopulate = workflowsMod.handlePopulate;
  } catch {
    enhancedLogger.warn('devSuiteWorkflows not available, skipping populate phase', LogCategory.COMMAND_EXECUTION);
  }

  // Phase 1: Scaffold
  await interaction.editReply('Running master test... Phase 1/7: Scaffold...');
  if (handleScaffoldAll) {
    try {
      // Check if systems are already configured before scaffolding
      const preCheck = await runSmokeTest(client, guildId);
      const configuredCount = preCheck.filter(r => r.status === 'configured').length;

      if (configuredCount >= preCheck.length) {
        masterResults.push({
          phase: 'Scaffold',
          passed: 1,
          failed: 0,
          warnings: 0,
          details: ['Skipped: all systems already configured'],
        });
        totalPassed++;
      } else {
        // We cannot call scaffold interactively, so note it
        masterResults.push({
          phase: 'Scaffold',
          passed: 0,
          failed: 0,
          warnings: 1,
          details: [
            `${preCheck.length - configuredCount} system(s) not configured. Run scaffold-all separately if needed.`,
          ],
        });
        totalWarnings++;
      }
    } catch (error) {
      masterResults.push({
        phase: 'Scaffold',
        passed: 0,
        failed: 1,
        warnings: 0,
        details: [(error as Error).message],
      });
      totalFailed++;
    }
  } else {
    masterResults.push({
      phase: 'Scaffold',
      passed: 0,
      failed: 0,
      warnings: 1,
      details: ['devSuiteScaffold module not available'],
    });
    totalWarnings++;
  }

  // Phase 2: Populate
  await interaction.editReply('Running master test... Phase 2/7: Populate...');
  if (handlePopulate) {
    masterResults.push({
      phase: 'Populate',
      passed: 0,
      failed: 0,
      warnings: 1,
      details: ['Populate available but requires interactive context. Run populate separately if needed.'],
    });
    totalWarnings++;
  } else {
    masterResults.push({
      phase: 'Populate',
      passed: 0,
      failed: 0,
      warnings: 1,
      details: ['devSuiteWorkflows module not available'],
    });
    totalWarnings++;
  }

  // Phase 3: Smoke Test
  await interaction.editReply('Running master test... Phase 3/7: Smoke test...');
  try {
    const smokeResults = await runSmokeTest(client, guildId);
    const configured = smokeResults.filter(r => r.status === 'configured').length;
    const withIssues = smokeResults.filter(r => r.issues.length > 0).length;
    const notConfigured = smokeResults.filter(r => r.status === 'not_configured').length;

    masterResults.push({
      phase: 'Smoke Test',
      passed: configured - withIssues,
      failed: withIssues,
      warnings: notConfigured,
      details: smokeResults.map(r => {
        if (r.status === 'not_configured') return `${r.name}: not configured`;
        if (r.issues.length > 0) return `${r.name}: ${r.issues.join(', ')}`;
        return `${r.name}: OK (${r.details})`;
      }),
    });
    totalPassed += configured - withIssues;
    totalFailed += withIssues;
    totalWarnings += notConfigured;
  } catch (error) {
    masterResults.push({
      phase: 'Smoke Test',
      passed: 0,
      failed: 1,
      warnings: 0,
      details: [(error as Error).message],
    });
    totalFailed++;
  }

  // Phase 4: Regression
  await interaction.editReply('Running master test... Phase 4/7: Regression tests...');
  try {
    const regressionResults = await runRegressionTests();
    const passed = regressionResults.filter(r => r.passed).length;
    const failed = regressionResults.filter(r => !r.passed).length;

    masterResults.push({
      phase: 'Regression',
      passed,
      failed,
      warnings: 0,
      details: regressionResults.map(r => `${r.passed ? 'PASS' : 'FAIL'} ${r.system}: ${r.details}`),
    });
    totalPassed += passed;
    totalFailed += failed;
  } catch (error) {
    masterResults.push({
      phase: 'Regression',
      passed: 0,
      failed: 1,
      warnings: 0,
      details: [(error as Error).message],
    });
    totalFailed++;
  }

  // Phase 5: Permissions Audit
  await interaction.editReply('Running master test... Phase 5/7: Permissions audit...');
  try {
    const auditResults = await runPermissionsAudit();
    const withCheck = auditResults.filter(r => r.hasPermissionCheck).length;
    const _withoutCheck = auditResults.filter(r => !r.hasPermissionCheck).length;

    // Only count as warning if file is NOT in the intentionally-public set
    const actualMissing = auditResults.filter(r => !r.hasPermissionCheck);

    masterResults.push({
      phase: 'Permissions Audit',
      passed: withCheck,
      failed: actualMissing.length,
      warnings: 0,
      details:
        actualMissing.length > 0
          ? actualMissing.map(r => `Missing permission check: ${r.file}`)
          : [`All ${withCheck} handlers have proper permission checks`],
    });
    totalPassed += withCheck;
    totalFailed += actualMissing.length;
  } catch (error) {
    masterResults.push({
      phase: 'Permissions Audit',
      passed: 0,
      failed: 1,
      warnings: 0,
      details: [(error as Error).message],
    });
    totalFailed++;
  }

  // Phase 6: Collect Results (no-op, results already aggregated)
  await interaction.editReply('Running master test... Phase 6/7: Collecting results...');

  // Phase 7: Teardown
  await interaction.editReply('Running master test... Phase 7/7: Teardown...');
  if (handleTeardownAll) {
    masterResults.push({
      phase: 'Teardown',
      passed: 0,
      failed: 0,
      warnings: 1,
      details: [
        'Teardown available but skipped (requires interactive context). Run teardown-all separately if needed.',
      ],
    });
    totalWarnings++;
  } else {
    masterResults.push({
      phase: 'Teardown',
      passed: 0,
      failed: 0,
      warnings: 1,
      details: ['devSuiteScaffold module not available'],
    });
    totalWarnings++;
  }

  // Build final summary embed
  const summaryEmbed = new EmbedBuilder()
    .setTitle('Master Test Summary')
    .setDescription(`**${totalPassed}** passed, **${totalFailed}** failed, **${totalWarnings}** warnings`)
    .setColor(totalFailed > 0 ? 0xff0000 : totalWarnings > 0 ? 0xffaa00 : 0x00ff00);

  for (const phase of masterResults) {
    const phaseIcon = phase.failed > 0 ? '\u274C' : phase.warnings > 0 ? '\u26A0\uFE0F' : '\u2705';

    const detailText =
      phase.details.length > 0
        ? phase.details.slice(0, 5).join('\n') +
          (phase.details.length > 5 ? `\n... and ${phase.details.length - 5} more` : '')
        : 'No details';

    summaryEmbed.addFields({
      name: `${phaseIcon} ${phase.phase} (${phase.passed}P / ${phase.failed}F / ${phase.warnings}W)`,
      value: detailText,
      inline: false,
    });
  }

  await interaction.editReply({ content: null, embeds: [summaryEmbed] });

  enhancedLogger.info('Master test completed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    passed: totalPassed,
    failed: totalFailed,
    warnings: totalWarnings,
  });
}
