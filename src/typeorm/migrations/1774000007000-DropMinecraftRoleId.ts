import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropMinecraftRoleId1774000007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure any remaining data is copied before dropping
    await queryRunner.query(
      `UPDATE \`announcement_config\` SET \`defaultRoleId\` = \`minecraftRoleId\` WHERE \`defaultRoleId\` IS NULL AND \`minecraftRoleId\` IS NOT NULL AND \`minecraftRoleId\` != ''`,
    );
    await queryRunner.query(`ALTER TABLE \`announcement_config\` DROP COLUMN \`minecraftRoleId\``);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`announcement_config\` ADD \`minecraftRoleId\` varchar(255) NOT NULL DEFAULT ''`,
    );
  }
}
