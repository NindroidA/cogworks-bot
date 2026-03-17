import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema baseline migration.
 *
 * This migration is intentionally empty — it represents the schema as it
 * existed when the migration system was introduced (v2.12.10+). All tables
 * were previously managed by TypeORM's `synchronize: true`.
 *
 * Future migrations should be generated against this baseline using:
 *   bun run migration:generate src/typeorm/migrations/MigrationName
 *
 * Or created manually:
 *   bun run migration:create src/typeorm/migrations/MigrationName
 */
export class InitialSchema1000000000000 implements MigrationInterface {
  name = 'InitialSchema1000000000000';

  async up(_queryRunner: QueryRunner): Promise<void> {
    // Baseline — no-op. Schema already exists from synchronize.
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Cannot reverse the initial schema.
  }
}
