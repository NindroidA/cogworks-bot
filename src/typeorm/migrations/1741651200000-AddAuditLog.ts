import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the audit_logs table for tracking dashboard-triggered actions.
 * 90-day TTL cleanup handled by logCleanup.ts.
 */
export class AddAuditLog1741651200000 implements MigrationInterface {
  name = 'AddAuditLog1741651200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`audit_logs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`action\` varchar(255) NOT NULL,
        \`triggeredBy\` varchar(255) NOT NULL,
        \`source\` varchar(255) NOT NULL DEFAULT 'dashboard',
        \`details\` json NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_audit_logs_guildId\` (\`guildId\`),
        INDEX \`IDX_audit_logs_guildId_createdAt\` (\`guildId\`, \`createdAt\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`audit_logs\``);
  }
}
