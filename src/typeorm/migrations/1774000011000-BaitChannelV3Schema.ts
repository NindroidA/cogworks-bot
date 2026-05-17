import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * v3.2.0 bait channel schema overhaul.
 *
 * 1. Renames `pending_bans` → `pending_actions` and generalizes it: action
 *    column lets the same row represent ban / kick / softban / timeout /
 *    log-only. attempts + lastError + deadAt support the retry queue.
 * 2. New `idempotency_keys` table — `(guildId, userId, action, dayBucket)`
 *    UNIQUE row prevents double-execution across the mod-vs-bot race + retry
 *    queue. expiresAt drives TTL cleanup.
 * 3. New `bait_channel_logs` columns for audit-log correlation
 *    (`discordAuditLogId`, `executorId`, `actionConfirmedAt`), unban tracking
 *    (`unbannedAt`, `unbannedBy`), DM observability (`dmFailureReason`,
 *    `logDeliveryFailed`).
 * 4. New `bait_channel_configs` columns for raid mode, cross-channel content
 *    burst detection, HMAC-signed appeal links, and per-guild log retention.
 *
 * Backfill strategy:
 * - Pre-existing pending_bans rows where `expiresAt < NOW()` are dropped
 *   inside the table rename (they're orphaned by definition — bot was offline
 *   long enough that the grace period elapsed; the user either left or
 *   evaded). Surviving rows get `action='ban'` default — current code only
 *   ever wrote ban-intent rows here.
 */
export class BaitChannelV3Schema1774000011000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1a. Drop expired pending_bans rows before the rename — they can't be
    // resumed; the grace timer they reference has already elapsed.
    await queryRunner.query(`DELETE FROM \`pending_bans\` WHERE \`expiresAt\` < NOW()`);

    // 1b. Rename pending_bans → pending_actions.
    await queryRunner.query(`RENAME TABLE \`pending_bans\` TO \`pending_actions\``);

    // 1c. Generalize: add action, attempts, lastError, deadAt.
    await queryRunner.query(`ALTER TABLE \`pending_actions\` ADD COLUMN \`action\` VARCHAR(32) NOT NULL DEFAULT 'ban'`);
    await queryRunner.query(`ALTER TABLE \`pending_actions\` ADD COLUMN \`attempts\` INT NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE \`pending_actions\` ADD COLUMN \`lastError\` TEXT NULL`);
    await queryRunner.query(`ALTER TABLE \`pending_actions\` ADD COLUMN \`deadAt\` DATETIME NULL`);
    // Supporting index — retry queue scans by (deadAt IS NULL, expiresAt) to find live rows.
    await queryRunner.query(
      `CREATE INDEX \`IDX_pending_actions_deadAt_expiresAt\` ON \`pending_actions\` (\`deadAt\`, \`expiresAt\`)`,
    );

    // 2. idempotency_keys table.
    await queryRunner.query(
      `CREATE TABLE \`idempotency_keys\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`guildId\` VARCHAR(255) NOT NULL,
        \`userId\` VARCHAR(255) NOT NULL,
        \`action\` VARCHAR(32) NOT NULL,
        \`dayBucket\` DATE NOT NULL,
        \`executorId\` VARCHAR(255) NULL,
        \`testMode\` TINYINT(1) NOT NULL DEFAULT 0,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`expiresAt\` DATETIME NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_idempotency_keys_guild_user_action_day\`
          (\`guildId\`, \`userId\`, \`action\`, \`dayBucket\`),
        INDEX \`IDX_idempotency_keys_expiresAt\` (\`expiresAt\`)
      ) ENGINE=InnoDB`,
    );

    // 3. bait_channel_logs additions.
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`discordAuditLogId\` VARCHAR(255) NULL`);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`executorId\` VARCHAR(255) NULL`);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`actionConfirmedAt\` DATETIME NULL`);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`unbannedAt\` DATETIME NULL`);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`unbannedBy\` VARCHAR(255) NULL`);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`dmSent\` TINYINT(1) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`dmFailureReason\` VARCHAR(64) NULL`);
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_logs\` ADD COLUMN \`logDeliveryFailed\` TINYINT(1) NOT NULL DEFAULT 0`,
    );

    // 4. bait_channel_configs additions — raid mode.
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`enableRaidMode\` TINYINT(1) NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`raidModeThreshold\` INT NOT NULL DEFAULT 5`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`raidModeWindowSeconds\` INT NOT NULL DEFAULT 60`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`raidModeAlertRoleId\` VARCHAR(255) NULL`,
    );
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`currentRaidModeUntil\` DATETIME NULL`);

    // bait_channel_configs additions — cross-channel content burst.
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`crossChannelBurstThreshold\` INT NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`crossChannelBurstWindowSeconds\` INT NOT NULL DEFAULT 30`,
    );

    // bait_channel_configs additions — appeal link.
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`enableAppealLink\` TINYINT(1) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`appealLinkBaseUrl\` VARCHAR(500) NULL`);

    // bait_channel_configs additions — log retention.
    await queryRunner.query(
      `ALTER TABLE \`bait_channel_configs\` ADD COLUMN \`logRetentionDays\` INT NOT NULL DEFAULT 90`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // bait_channel_configs — drop in reverse order.
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`logRetentionDays\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`appealLinkBaseUrl\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`enableAppealLink\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`crossChannelBurstWindowSeconds\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`crossChannelBurstThreshold\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`currentRaidModeUntil\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`raidModeAlertRoleId\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`raidModeWindowSeconds\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`raidModeThreshold\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`enableRaidMode\``);

    // bait_channel_logs.
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`logDeliveryFailed\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`dmFailureReason\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`dmSent\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`unbannedBy\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`unbannedAt\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`actionConfirmedAt\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`executorId\``);
    await queryRunner.query(`ALTER TABLE \`bait_channel_logs\` DROP COLUMN \`discordAuditLogId\``);

    // idempotency_keys.
    await queryRunner.query(`DROP TABLE \`idempotency_keys\``);

    // pending_actions — drop new columns, then rename back.
    await queryRunner.query(`DROP INDEX \`IDX_pending_actions_deadAt_expiresAt\` ON \`pending_actions\``);
    await queryRunner.query(`ALTER TABLE \`pending_actions\` DROP COLUMN \`deadAt\``);
    await queryRunner.query(`ALTER TABLE \`pending_actions\` DROP COLUMN \`lastError\``);
    await queryRunner.query(`ALTER TABLE \`pending_actions\` DROP COLUMN \`attempts\``);
    await queryRunner.query(`ALTER TABLE \`pending_actions\` DROP COLUMN \`action\``);
    await queryRunner.query(`RENAME TABLE \`pending_actions\` TO \`pending_bans\``);
  }
}
