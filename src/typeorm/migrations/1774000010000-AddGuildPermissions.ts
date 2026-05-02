import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `guild_permissions` table for v3.1.3 feature-based permissions.
 *
 * Unique index on `(guildId, feature, roleId)` lets the API treat POST as an
 * idempotent upsert. Supporting index on `(guildId, feature)` keeps the
 * per-command permission check cheap.
 *
 * Non-breaking by design: unconfigured guilds (no rows) continue to behave
 * exactly like before — admin-only, enforced by the legacy `requireAdmin`
 * path. The new check layers on top only when rows exist.
 */
export class AddGuildPermissions1774000010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`guild_permissions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`feature\` varchar(64) NOT NULL,
        \`roleId\` varchar(255) NOT NULL,
        \`level\` varchar(16) NOT NULL DEFAULT 'use',
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_guild_permissions_guild_feature_role\` (\`guildId\`, \`feature\`, \`roleId\`),
        INDEX \`IDX_guild_permissions_guild_feature\` (\`guildId\`, \`feature\`)
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`guild_permissions\``);
  }
}
