import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeleteMessageHours1774000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` ADD \`deleteMessageHours\` int NOT NULL DEFAULT 24`);
    // Backfill from existing deleteMessageDays (default was 7 → becomes 168 hours)
    await queryRunner.query(
      `UPDATE \`bait_channel_configs\` SET \`deleteMessageHours\` = \`deleteMessageDays\` * 24 WHERE \`deleteMessageDays\` != 7`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`deleteMessageHours\``);
  }
}
