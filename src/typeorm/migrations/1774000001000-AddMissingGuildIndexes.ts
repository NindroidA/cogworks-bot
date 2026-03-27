import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds explicit guildId indexes to config entities that previously only
 * had a UNIQUE constraint. While MySQL creates an implicit index for
 * UNIQUE constraints, explicit indexes improve query planner hinting
 * and make the intent clear.
 */
export class AddMissingGuildIndexes1774000001000 implements MigrationInterface {
  private readonly tables = [
    'bait_channel_configs',
    'announcement_config', // AnnouncementConfig uses default table name
    'application_configs',
    'archived_application_configs',
    'event_configs',
    'onboarding_configs',
    'starboard_config',
    'archived_ticket_configs',
    'announcement_templates',
    'rules_configs',
    'setup_states',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      const hasTable = await queryRunner.hasTable(table);
      if (!hasTable) continue;

      // Check if index already exists (idempotent)
      const indexes = await queryRunner.query(
        `SHOW INDEX FROM \`${table}\` WHERE Column_name = 'guildId' AND Key_name != 'PRIMARY' AND Key_name NOT LIKE 'UQ%'`,
      );
      if (indexes.length > 0) continue;

      await queryRunner.query(`CREATE INDEX \`IDX_${table}_guildId\` ON \`${table}\` (\`guildId\`)`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      const hasTable = await queryRunner.hasTable(table);
      if (!hasTable) continue;

      try {
        await queryRunner.query(`DROP INDEX \`IDX_${table}_guildId\` ON \`${table}\``);
      } catch {
        // Index may not exist
      }
    }
  }
}
