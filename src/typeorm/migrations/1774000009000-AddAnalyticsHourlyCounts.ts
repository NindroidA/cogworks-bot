import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `hourlyCounts` JSON column to `analytics_snapshot` so the
 * `/analytics/hours` API endpoint can return a 24-slot activity heatmap
 * instead of the old peak-hour-only approximation.
 *
 * Nullable to stay backfill-friendly: pre-existing rows keep NULL and the
 * API treats that as "no hourly data for this day".
 */
export class AddAnalyticsHourlyCounts1774000009000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`analytics_snapshot\` ADD \`hourlyCounts\` text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`analytics_snapshot\` DROP COLUMN \`hourlyCounts\``);
  }
}
