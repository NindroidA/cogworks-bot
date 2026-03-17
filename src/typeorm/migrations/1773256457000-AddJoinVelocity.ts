import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the join_events table for tracking member joins per guild,
 * and join velocity config columns to bait_channel_configs.
 * 7-day TTL cleanup handled by logCleanup.ts.
 */
export class AddJoinVelocity1773256457000 implements MigrationInterface {
  name = 'AddJoinVelocity1773256457000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Create join_events table
    await queryRunner.query(`
      CREATE TABLE \`join_events\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`joinedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`accountCreatedAt\` datetime NOT NULL,
        \`hasDefaultAvatar\` tinyint NOT NULL DEFAULT 0,
        \`roleCount\` int NOT NULL DEFAULT 1,
        \`isSuspicious\` tinyint NOT NULL DEFAULT 0,
        \`suspicionReasons\` text NULL,
        INDEX \`IDX_join_events_guildId\` (\`guildId\`),
        INDEX \`IDX_join_events_guildId_joinedAt\` (\`guildId\`, \`joinedAt\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // Add join velocity config columns to bait_channel_configs
    await queryRunner.query(`
      ALTER TABLE \`bait_channel_configs\`
      ADD COLUMN \`joinVelocityThreshold\` int NOT NULL DEFAULT 10,
      ADD COLUMN \`joinVelocityWindowMinutes\` int NOT NULL DEFAULT 5
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`bait_channel_configs\`
      DROP COLUMN \`joinVelocityThreshold\`,
      DROP COLUMN \`joinVelocityWindowMinutes\`
    `);
    await queryRunner.query(`DROP TABLE \`join_events\``);
  }
}
