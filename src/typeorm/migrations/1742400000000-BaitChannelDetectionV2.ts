import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidated migration for Bait Channel Detection V2 features.
 *
 * Changes:
 * - CREATE TABLE bait_keywords (custom keyword scoring)
 * - CREATE TABLE join_events (member join tracking with burst detection)
 * - ALTER TABLE bait_channel_configs: add timeout, escalation, DM, appeal,
 *   join velocity, multi-channel, test mode, weekly summary columns
 * - ALTER TABLE bait_channel_logs: add override tracking columns
 * - Data migration: populate channelIds from existing channelId
 *
 * Note: Earlier plans shipped individual migrations for subsets of these changes
 * (1773170058000-AddBaitChannelActionColumns, 1773256457000-AddJoinVelocity).
 * This migration is safe to run alongside them — it uses IF NOT EXISTS / IF EXISTS
 * guards so columns/tables are not duplicated.
 */
export class BaitChannelDetectionV21742400000000 implements MigrationInterface {
  name = 'BaitChannelDetectionV21742400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. CREATE TABLE bait_keywords ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`bait_keywords\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`keyword\` varchar(100) NOT NULL,
        \`weight\` int NOT NULL DEFAULT 5,
        \`createdBy\` varchar(255) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_bait_keywords_guildId\` (\`guildId\`),
        UNIQUE \`UQ_bait_keywords_guildId_keyword\` (\`guildId\`, \`keyword\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 2. CREATE TABLE join_events ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`join_events\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`joinedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`accountCreatedAt\` datetime NOT NULL,
        \`hasDefaultAvatar\` tinyint NOT NULL DEFAULT 0,
        \`roleCount\` int NOT NULL DEFAULT 1,
        \`isSuspicious\` tinyint NOT NULL DEFAULT 0,
        \`suspicionReasons\` text NULL,
        INDEX \`IDX_join_events_guildId\` (\`guildId\`),
        INDEX \`IDX_join_events_guildId_joinedAt\` (\`guildId\`, \`joinedAt\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── 3. ALTER TABLE bait_channel_configs ─────────────────────────────
    // Use a helper to add columns only if they don't already exist
    const configColumns: Array<{ name: string; definition: string }> = [
      { name: 'timeoutDurationMinutes', definition: 'int NOT NULL DEFAULT 60' },
      { name: 'enableEscalation', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'escalationLogThreshold', definition: 'int NOT NULL DEFAULT 30' },
      { name: 'escalationTimeoutThreshold', definition: 'int NOT NULL DEFAULT 50' },
      { name: 'escalationKickThreshold', definition: 'int NOT NULL DEFAULT 75' },
      { name: 'escalationBanThreshold', definition: 'int NOT NULL DEFAULT 90' },
      { name: 'dmBeforeAction', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'appealInfo', definition: 'varchar(500) NULL' },
      { name: 'joinVelocityThreshold', definition: 'int NOT NULL DEFAULT 10' },
      { name: 'joinVelocityWindowMinutes', definition: 'int NOT NULL DEFAULT 5' },
      { name: 'channelIds', definition: 'text NULL' },
      { name: 'testMode', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'enableWeeklySummary', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'summaryChannelId', definition: 'varchar(255) NULL' },
    ];

    for (const col of configColumns) {
      const exists = await this.columnExists(queryRunner, 'bait_channel_configs', col.name);
      if (!exists) {
        await queryRunner.query(
          `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`${col.name}\` ${col.definition}`,
        );
      }
    }

    // ── 4. ALTER TABLE bait_channel_logs ────────────────────────────────
    const logColumns: Array<{ name: string; definition: string }> = [
      { name: 'overridden', definition: 'tinyint NOT NULL DEFAULT 0' },
      { name: 'overriddenBy', definition: 'varchar(255) NULL' },
      { name: 'overriddenAt', definition: 'datetime NULL' },
    ];

    for (const col of logColumns) {
      const exists = await this.columnExists(queryRunner, 'bait_channel_logs', col.name);
      if (!exists) {
        await queryRunner.query(
          `ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`${col.name}\` ${col.definition}`,
        );
      }
    }

    // ── 5. Data migration: populate channelIds from channelId ───────────
    await queryRunner.query(`
      UPDATE \`bait_channel_configs\`
      SET \`channelIds\` = \`channelId\`
      WHERE \`channelId\` IS NOT NULL AND (\`channelIds\` IS NULL OR \`channelIds\` = '')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // ── Reverse order ──────────────────────────────────────────────────

    // 4. Drop override columns from bait_channel_logs
    for (const col of ['overriddenAt', 'overriddenBy', 'overridden']) {
      const exists = await this.columnExists(queryRunner, 'bait_channel_logs', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`${col}\``);
      }
    }

    // 3. Drop new columns from bait_channel_configs
    for (const col of [
      'summaryChannelId',
      'enableWeeklySummary',
      'testMode',
      'channelIds',
      'joinVelocityWindowMinutes',
      'joinVelocityThreshold',
      'appealInfo',
      'dmBeforeAction',
      'escalationBanThreshold',
      'escalationKickThreshold',
      'escalationTimeoutThreshold',
      'escalationLogThreshold',
      'enableEscalation',
      'timeoutDurationMinutes',
    ]) {
      const exists = await this.columnExists(queryRunner, 'bait_channel_configs', col);
      if (exists) {
        await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`${col}\``);
      }
    }

    // 2. Drop join_events table
    await queryRunner.query(`DROP TABLE IF EXISTS \`join_events\``);

    // 1. Drop bait_keywords table
    await queryRunner.query(`DROP TABLE IF EXISTS \`bait_keywords\``);
  }

  private async columnExists(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<boolean> {
    const result = await queryRunner.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return result[0]?.cnt > 0;
  }
}
