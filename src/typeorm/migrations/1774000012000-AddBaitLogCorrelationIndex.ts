import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `(guildId, userId, createdAt)` index on `bait_channel_logs`.
 *
 * The audit-log correlation handlers (`confirmSelfAction`,
 * `handleModSupersedes`, `handleUnban` in `events/auditLogEntryCreate.ts`)
 * all filter by exactly this triple on every relevant audit-log event; the
 * existing `(guildId, createdAt)` index leaves them scanning every row for
 * the guild. Additive and non-breaking — dev (`synchronize: true`) picks the
 * decorator up automatically; this migration covers prod.
 */
export class AddBaitLogCorrelationIndex1774000012000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX `IDX_bait_logs_guild_user_created` ON `bait_channel_logs` (`guildId`, `userId`, `createdAt`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX `IDX_bait_logs_guild_user_created` ON `bait_channel_logs`');
  }
}
