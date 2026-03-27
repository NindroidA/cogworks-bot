import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comprehensive catch-up migration for Cogworks v3.
 *
 * Creates 15 missing tables and adds 28 missing columns to existing tables.
 * All operations are idempotent: CREATE TABLE IF NOT EXISTS + columnExists guards.
 */
export class AddMissingV3Schema1774000003000 implements MigrationInterface {
  name = 'AddMissingV3Schema1774000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ══════════════════════════════════════════════════════════════════════
    // PART 1 — CREATE MISSING TABLES (15 tables)
    // ══════════════════════════════════════════════════════════════════════

    // ── 1. announcement_templates ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`announcement_templates\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`name\` varchar(50) NOT NULL,
        \`displayName\` varchar(100) NOT NULL,
        \`description\` varchar(256) NULL,
        \`color\` varchar(7) NOT NULL DEFAULT '#5865F2',
        \`title\` varchar(256) NOT NULL,
        \`body\` text NOT NULL,
        \`fields\` text NULL,
        \`footerText\` varchar(256) NULL,
        \`showTimestamp\` tinyint NOT NULL DEFAULT 1,
        \`mentionRole\` tinyint NOT NULL DEFAULT 0,
        \`isDefault\` tinyint NOT NULL DEFAULT 0,
        \`createdBy\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_announcement_templates_guildId\` (\`guildId\`),
        UNIQUE \`UQ_announcement_templates_guildId_name\` (\`guildId\`, \`name\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 2. starboard_config ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`starboard_config\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 0,
        \`channelId\` varchar(255) NOT NULL,
        \`emoji\` varchar(255) NOT NULL DEFAULT '⭐',
        \`threshold\` int NOT NULL DEFAULT 3,
        \`selfStar\` tinyint NOT NULL DEFAULT 0,
        \`ignoredChannels\` text NULL,
        \`ignoreBots\` tinyint NOT NULL DEFAULT 1,
        \`ignoreNSFW\` tinyint NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_starboard_config_guildId\` (\`guildId\`),
        UNIQUE \`UQ_starboard_config_guildId\` (\`guildId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 3. starboard_entries ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`starboard_entries\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`originalMessageId\` varchar(255) NOT NULL,
        \`originalChannelId\` varchar(255) NOT NULL,
        \`authorId\` varchar(255) NOT NULL,
        \`starboardMessageId\` varchar(255) NOT NULL,
        \`starCount\` int NOT NULL,
        \`content\` text NULL,
        \`attachmentUrl\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_starboard_entries_guildId\` (\`guildId\`),
        UNIQUE \`UQ_starboard_entries_guildId_originalMessageId\` (\`guildId\`, \`originalMessageId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 4. xp_configs ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`xp_configs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 0,
        \`xpPerMessageMin\` int NOT NULL DEFAULT 15,
        \`xpPerMessageMax\` int NOT NULL DEFAULT 25,
        \`xpCooldownSeconds\` int NOT NULL DEFAULT 60,
        \`xpPerVoiceMinute\` int NOT NULL DEFAULT 5,
        \`voiceXpEnabled\` tinyint NOT NULL DEFAULT 1,
        \`levelUpChannelId\` varchar(255) NULL,
        \`levelUpMessage\` varchar(255) NOT NULL DEFAULT 'Congrats {user}, you reached **Level {level}**!',
        \`ignoredChannels\` text NULL,
        \`ignoredRoles\` text NULL,
        \`multiplierChannels\` text NULL,
        \`stackMultipliers\` tinyint NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE \`UQ_xp_configs_guildId\` (\`guildId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 5. xp_users ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`xp_users\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`xp\` int NOT NULL DEFAULT 0,
        \`level\` int NOT NULL DEFAULT 0,
        \`messages\` int NOT NULL DEFAULT 0,
        \`voiceMinutes\` int NOT NULL DEFAULT 0,
        \`lastXpAt\` datetime NULL,
        \`lastVoiceJoinedAt\` datetime NULL,
        INDEX \`IDX_xp_users_guildId\` (\`guildId\`),
        INDEX \`IDX_xp_users_guildId_xp\` (\`guildId\`, \`xp\`),
        UNIQUE \`UQ_xp_users_guildId_userId\` (\`guildId\`, \`userId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 6. xp_role_rewards ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`xp_role_rewards\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`level\` int NOT NULL,
        \`roleId\` varchar(255) NOT NULL,
        \`removeOnDelevel\` tinyint NOT NULL DEFAULT 0,
        INDEX \`IDX_xp_role_rewards_guildId\` (\`guildId\`),
        INDEX \`IDX_xp_role_rewards_guildId_level\` (\`guildId\`, \`level\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 7. event_configs ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`event_configs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 0,
        \`reminderChannelId\` varchar(255) NULL,
        \`defaultReminderMinutes\` int NOT NULL DEFAULT 30,
        \`postEventSummary\` tinyint NOT NULL DEFAULT 0,
        \`summaryChannelId\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_event_configs_guildId\` (\`guildId\`),
        UNIQUE \`UQ_event_configs_guildId\` (\`guildId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 8. event_templates ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`event_templates\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`name\` varchar(50) NOT NULL,
        \`title\` varchar(100) NOT NULL,
        \`description\` text NULL,
        \`location\` varchar(256) NULL,
        \`entityType\` varchar(20) NOT NULL DEFAULT 'external',
        \`defaultDurationMinutes\` int NOT NULL DEFAULT 60,
        \`isRecurring\` tinyint NOT NULL DEFAULT 0,
        \`recurringPattern\` varchar(20) NULL,
        \`createdBy\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_event_templates_guildId\` (\`guildId\`),
        UNIQUE \`UQ_event_templates_guildId_name\` (\`guildId\`, \`name\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 9. event_reminders ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`event_reminders\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`discordEventId\` varchar(255) NOT NULL,
        \`reminderAt\` datetime NOT NULL,
        \`sent\` tinyint NOT NULL DEFAULT 0,
        \`eventTitle\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_event_reminders_guildId\` (\`guildId\`),
        INDEX \`IDX_event_reminders_sent_reminderAt\` (\`sent\`, \`reminderAt\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 10. analytics_config ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`analytics_config\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 0,
        \`digestChannelId\` varchar(255) NULL,
        \`digestFrequency\` varchar(255) NOT NULL DEFAULT 'weekly',
        \`digestDay\` int NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE \`UQ_analytics_config_guildId\` (\`guildId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 11. analytics_snapshot ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`analytics_snapshot\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`date\` date NOT NULL,
        \`memberCount\` int NOT NULL DEFAULT 0,
        \`memberJoined\` int NOT NULL DEFAULT 0,
        \`memberLeft\` int NOT NULL DEFAULT 0,
        \`messageCount\` int NOT NULL DEFAULT 0,
        \`activeMembers\` int NOT NULL DEFAULT 0,
        \`voiceMinutes\` int NOT NULL DEFAULT 0,
        \`topChannels\` text NULL,
        \`peakHourUtc\` int NULL,
        UNIQUE \`UQ_analytics_snapshot_guildId_date\` (\`guildId\`, \`date\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 12. onboarding_configs ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`onboarding_configs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`enabled\` tinyint NOT NULL DEFAULT 0,
        \`welcomeMessage\` varchar(2000) NOT NULL DEFAULT 'Welcome to {server}!',
        \`steps\` text NULL,
        \`completionRoleId\` varchar(255) NULL,
        \`trackCompletionRate\` tinyint NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_onboarding_configs_guildId\` (\`guildId\`),
        UNIQUE \`UQ_onboarding_configs_guildId\` (\`guildId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 13. onboarding_completions ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`onboarding_completions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`completedSteps\` text NULL,
        \`completedAt\` datetime NULL,
        \`startedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`lastStepAt\` datetime NULL,
        UNIQUE \`UQ_onboarding_completions_guildId_userId\` (\`guildId\`, \`userId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 14. import_logs ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`import_logs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`source\` varchar(255) NOT NULL,
        \`dataType\` varchar(255) NOT NULL,
        \`importedCount\` int NOT NULL DEFAULT 0,
        \`skippedCount\` int NOT NULL DEFAULT 0,
        \`failedCount\` int NOT NULL DEFAULT 0,
        \`errors\` text NULL,
        \`triggeredBy\` varchar(255) NOT NULL,
        \`startedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`completedAt\` datetime NULL,
        \`status\` varchar(255) NOT NULL DEFAULT 'running',
        \`durationMs\` int NULL,
        INDEX \`IDX_import_logs_guildId\` (\`guildId\`),
        INDEX \`IDX_import_logs_guildId_status\` (\`guildId\`, \`status\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 15. status_incidents ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`status_incidents\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`level\` varchar(20) NOT NULL,
        \`message\` text NOT NULL,
        \`startedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`resolvedAt\` datetime NULL,
        \`resolvedBy\` varchar(255) NULL,
        \`affectedSystems\` text NULL,
        INDEX \`IDX_status_incidents_resolvedAt\` (\`resolvedAt\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 16. pending_bans (baseline table, safety net) ──────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`pending_bans\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`messageId\` varchar(255) NOT NULL,
        \`channelId\` varchar(255) NOT NULL,
        \`suspicionScore\` int NOT NULL DEFAULT 0,
        \`warningMessageId\` varchar(255) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`expiresAt\` datetime NOT NULL,
        INDEX \`IDX_pending_bans_guildId\` (\`guildId\`),
        INDEX \`IDX_pending_bans_guildId_expiresAt\` (\`guildId\`, \`expiresAt\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 17. custom_ticket_types (baseline table, safety net) ─────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`custom_ticket_types\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`typeId\` varchar(50) NOT NULL,
        \`displayName\` varchar(100) NOT NULL,
        \`emoji\` varchar(50) NULL,
        \`color\` varchar(7) NULL,
        \`description\` varchar(256) NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`isDefault\` tinyint NOT NULL DEFAULT 0,
        \`pingStaffOnCreate\` tinyint NOT NULL DEFAULT 0,
        \`fields\` text NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_custom_ticket_types_guildId\` (\`guildId\`),
        UNIQUE \`UQ_custom_ticket_types_guildId_typeId\` (\`guildId\`, \`typeId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 18. user_ticket_restrictions (baseline table, safety net) ────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`user_ticket_restrictions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`restrictedTypeIds\` text NULL,
        \`restrictAll\` tinyint NOT NULL DEFAULT 0,
        \`reason\` varchar(500) NULL,
        \`restrictedBy\` varchar(255) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_user_ticket_restrictions_guildId\` (\`guildId\`),
        UNIQUE \`UQ_user_ticket_restrictions_guildId_userId\` (\`guildId\`, \`userId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ══════════════════════════════════════════════════════════════════════
    // PART 2 — ADD MISSING COLUMNS TO EXISTING TABLES (38 columns)
    // ══════════════════════════════════════════════════════════════════════

    // ── announcement_config: 1 column ──────────────────────────────────
    const announcementConfigCols: Array<{ name: string; definition: string }> = [
      { name: 'defaultRoleId', definition: 'varchar(255) NULL' },
    ];

    for (const col of announcementConfigCols) {
      const exists = await this.columnExists(queryRunner, 'announcement_config', col.name);
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`announcement_config\` ADD COLUMN \`${col.name}\` ${col.definition}`);
      }
    }

    // ── application_configs: 2 columns ─────────────────────────────────
    const applicationConfigCols: Array<{ name: string; definition: string }> = [
      { name: 'enableWorkflow', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'workflowStatuses', definition: 'text NULL' },
    ];

    for (const col of applicationConfigCols) {
      const exists = await this.columnExists(queryRunner, 'application_configs', col.name);
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`application_configs\` ADD COLUMN \`${col.name}\` ${col.definition}`);
      }
    }

    // ── applications: 4 columns ────────────────────────────────────────
    const applicationCols: Array<{ name: string; definition: string }> = [
      { name: 'reviewedBy', definition: 'varchar(255) NULL' },
      { name: 'reviewedAt', definition: 'datetime NULL' },
      { name: 'internalNotes', definition: 'text NULL' },
      { name: 'statusHistory', definition: 'text NULL' },
    ];

    for (const col of applicationCols) {
      const exists = await this.columnExists(queryRunner, 'applications', col.name);
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`applications\` ADD COLUMN \`${col.name}\` ${col.definition}`);
      }
    }

    // ── ticket_configs: 13 columns ─────────────────────────────────────
    const ticketConfigCols: Array<{ name: string; definition: string }> = [
      { name: 'enableWorkflow', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'workflowStatuses', definition: 'text NULL' },
      { name: 'autoCloseEnabled', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'autoCloseDays', definition: 'int NOT NULL DEFAULT 7' },
      { name: 'autoCloseWarningHours', definition: 'int NOT NULL DEFAULT 24' },
      {
        name: 'autoCloseStatus',
        definition: "varchar(255) NOT NULL DEFAULT 'resolved'",
      },
      { name: 'slaEnabled', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'slaTargetMinutes', definition: 'int NOT NULL DEFAULT 60' },
      { name: 'slaBreachChannelId', definition: 'varchar(255) NULL' },
      { name: 'slaPerType', definition: 'text NULL' },
      { name: 'smartRoutingEnabled', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'routingRules', definition: 'text NULL' },
      {
        name: 'routingStrategy',
        definition: "varchar(255) NOT NULL DEFAULT 'least-load'",
      },
    ];

    for (const col of ticketConfigCols) {
      const exists = await this.columnExists(queryRunner, 'ticket_configs', col.name);
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`ticket_configs\` ADD COLUMN \`${col.name}\` ${col.definition}`);
      }
    }

    // ── tickets: 7 columns ─────────────────────────────────────────────
    const ticketCols: Array<{ name: string; definition: string }> = [
      { name: 'assignedTo', definition: 'varchar(255) NULL' },
      { name: 'assignedAt', definition: 'datetime NULL' },
      {
        name: 'lastActivityAt',
        definition: 'datetime NOT NULL DEFAULT CURRENT_TIMESTAMP',
      },
      { name: 'statusHistory', definition: 'text NULL' },
      { name: 'firstResponseAt', definition: 'datetime NULL' },
      { name: 'slaBreached', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'slaBreachNotified', definition: 'tinyint NOT NULL DEFAULT 0' },
    ];

    for (const col of ticketCols) {
      const exists = await this.columnExists(queryRunner, 'tickets', col.name);
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`tickets\` ADD COLUMN \`${col.name}\` ${col.definition}`);
      }
    }

    // ── bot_status: 1 column ───────────────────────────────────────────
    const botStatusCols: Array<{ name: string; definition: string }> = [
      { name: 'externalMonitorUrl', definition: 'varchar(512) NULL' },
    ];

    for (const col of botStatusCols) {
      const exists = await this.columnExists(queryRunner, 'bot_status', col.name);
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`bot_status\` ADD COLUMN \`${col.name}\` ${col.definition}`);
      }
    }

    // ── bait_channel_configs: 10 columns (smart detection + action settings) ─
    const baitCols: Array<{ name: string; definition: string }> = [
      {
        name: 'enableSmartDetection',
        definition: 'tinyint NOT NULL DEFAULT 1',
      },
      { name: 'instantActionThreshold', definition: 'int NOT NULL DEFAULT 90' },
      { name: 'minAccountAgeDays', definition: 'int NOT NULL DEFAULT 7' },
      { name: 'minMembershipMinutes', definition: 'int NOT NULL DEFAULT 5' },
      { name: 'minMessageCount', definition: 'int NOT NULL DEFAULT 0' },
      { name: 'requireVerification', definition: 'tinyint NOT NULL DEFAULT 0' },
      {
        name: 'disableAdminWhitelist',
        definition: 'tinyint NOT NULL DEFAULT 0',
      },
      { name: 'actionType', definition: "varchar(255) NOT NULL DEFAULT 'ban'" },
      { name: 'deleteUserMessages', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'deleteMessageDays', definition: 'int NOT NULL DEFAULT 7' },
    ];

    for (const col of baitCols) {
      const exists = await this.columnExists(queryRunner, 'bait_channel_configs', col.name);
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`${col.name}\` ${col.definition}`);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // ══════════════════════════════════════════════════════════════════════
    // REVERSE PART 2 — DROP ADDED COLUMNS (reverse order)
    // ══════════════════════════════════════════════════════════════════════

    // ── bait_channel_configs ────────────────────────────────────────────
    for (const col of [
      'deleteMessageDays',
      'deleteUserMessages',
      'actionType',
      'disableAdminWhitelist',
      'requireVerification',
      'minMessageCount',
      'minMembershipMinutes',
      'minAccountAgeDays',
      'instantActionThreshold',
      'enableSmartDetection',
    ]) {
      const exists = await this.columnExists(queryRunner, 'bait_channel_configs', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`${col}\``);
      }
    }

    // ── bot_status ─────────────────────────────────────────────────────
    for (const col of ['externalMonitorUrl']) {
      const exists = await this.columnExists(queryRunner, 'bot_status', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`bot_status\` DROP COLUMN \`${col}\``);
      }
    }

    // ── tickets ────────────────────────────────────────────────────────
    for (const col of [
      'slaBreachNotified',
      'slaBreached',
      'firstResponseAt',
      'statusHistory',
      'lastActivityAt',
      'assignedAt',
      'assignedTo',
    ]) {
      const exists = await this.columnExists(queryRunner, 'tickets', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`tickets\` DROP COLUMN \`${col}\``);
      }
    }

    // ── ticket_configs ─────────────────────────────────────────────────
    for (const col of [
      'routingStrategy',
      'routingRules',
      'smartRoutingEnabled',
      'slaPerType',
      'slaBreachChannelId',
      'slaTargetMinutes',
      'slaEnabled',
      'autoCloseStatus',
      'autoCloseWarningHours',
      'autoCloseDays',
      'autoCloseEnabled',
      'workflowStatuses',
      'enableWorkflow',
    ]) {
      const exists = await this.columnExists(queryRunner, 'ticket_configs', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`ticket_configs\` DROP COLUMN \`${col}\``);
      }
    }

    // ── applications ───────────────────────────────────────────────────
    for (const col of ['statusHistory', 'internalNotes', 'reviewedAt', 'reviewedBy']) {
      const exists = await this.columnExists(queryRunner, 'applications', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`applications\` DROP COLUMN \`${col}\``);
      }
    }

    // ── application_configs ────────────────────────────────────────────
    for (const col of ['workflowStatuses', 'enableWorkflow']) {
      const exists = await this.columnExists(queryRunner, 'application_configs', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`application_configs\` DROP COLUMN \`${col}\``);
      }
    }

    // ── announcement_config ────────────────────────────────────────────
    for (const col of ['defaultRoleId']) {
      const exists = await this.columnExists(queryRunner, 'announcement_config', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`announcement_config\` DROP COLUMN \`${col}\``);
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // REVERSE PART 1 — DROP CREATED TABLES (reverse order)
    // ══════════════════════════════════════════════════════════════════════

    await queryRunner.query(`DROP TABLE IF EXISTS \`status_incidents\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`import_logs\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`onboarding_completions\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`onboarding_configs\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`analytics_snapshot\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`analytics_config\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`event_reminders\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`event_templates\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`event_configs\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`xp_role_rewards\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`xp_users\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`xp_configs\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`starboard_entries\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`starboard_config\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`announcement_templates\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`user_ticket_restrictions\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`custom_ticket_types\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`pending_bans\``);
  }

  private async columnExists(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
    const result = await queryRunner.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return result[0]?.cnt > 0;
  }
}
