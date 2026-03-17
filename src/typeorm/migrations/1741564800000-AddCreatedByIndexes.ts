import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds composite indexes on [guildId, createdBy] for ticket and application
 * tables. These indexes improve query performance for guild-scoped lookups
 * by creator (e.g., "find user's tickets in this guild").
 */
export class AddCreatedByIndexes1741564800000 implements MigrationInterface {
  name = 'AddCreatedByIndexes1741564800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX \`IDX_tickets_guildId_createdBy\` ON \`tickets\` (\`guildId\`, \`createdBy\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_applications_guildId_createdBy\` ON \`applications\` (\`guildId\`, \`createdBy\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_archived_tickets_guildId_createdBy\` ON \`archived_tickets\` (\`guildId\`, \`createdBy\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_archived_applications_guildId_createdBy\` ON \`archived_applications\` (\`guildId\`, \`createdBy\`)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`IDX_tickets_guildId_createdBy\` ON \`tickets\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_applications_guildId_createdBy\` ON \`applications\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_archived_tickets_guildId_createdBy\` ON \`archived_tickets\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_archived_applications_guildId_createdBy\` ON \`archived_applications\``,
    );
  }
}
