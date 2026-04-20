import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `locale` column to `bot_configs` for per-guild i18n.
 *
 * `default: 'en'` keeps all existing rows on English. The app layer
 * (`src/lang/getGuildLocale`) independently guards against unknown values, so
 * this migration is safe to run ahead of any translation UI rollout.
 */
export class AddBotConfigLocale1774000008000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bot_configs\` ADD \`locale\` varchar(10) NOT NULL DEFAULT 'en'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bot_configs\` DROP COLUMN \`locale\``);
  }
}
