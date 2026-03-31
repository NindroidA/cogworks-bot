import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropDeleteMessageDays1774000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` DROP COLUMN \`deleteMessageDays\``);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`bait_channel_configs\` ADD \`deleteMessageDays\` int NOT NULL DEFAULT 7`);
  }
}
