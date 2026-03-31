import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates baseline tables that were missing from AddMissingV3Schema
 * (which ran before these were added to it).
 */
export class AddRemainingBaseline1774000004000 implements MigrationInterface {
  name = 'AddRemainingBaseline1774000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`pending_bans\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`messageId\` varchar(255) NOT NULL,
        \`channelId\` varchar(255) NOT NULL,
        \`suspicionScore\` int NOT NULL DEFAULT 0,
        \`warningMessageId\` varchar(255) NULL,
        \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`expiresAt\` datetime NOT NULL,
        INDEX \`IDX_pending_bans_guildId\` (\`guildId\`),
        INDEX \`IDX_pending_bans_guildId_expiresAt\` (\`guildId\`, \`expiresAt\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`custom_ticket_types\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`typeId\` varchar(50) NOT NULL,
        \`displayName\` varchar(100) NOT NULL,
        \`emoji\` varchar(50) NULL,
        \`color\` varchar(7) NULL,
        \`description\` varchar(256) NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`isDefault\` tinyint NOT NULL DEFAULT 0,
        \`pingStaffOnCreate\` tinyint NOT NULL DEFAULT 0,
        \`fields\` text NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_custom_ticket_types_guildId\` (\`guildId\`),
        UNIQUE \`UQ_custom_ticket_types_guildId_typeId\` (\`guildId\`, \`typeId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`user_ticket_restrictions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`guildId\` varchar(255) NOT NULL,
        \`userId\` varchar(255) NOT NULL,
        \`restrictedTypeIds\` text NULL,
        \`restrictAll\` tinyint NOT NULL DEFAULT 0,
        \`reason\` varchar(500) NULL,
        \`restrictedBy\` varchar(255) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_user_ticket_restrictions_guildId\` (\`guildId\`),
        UNIQUE \`UQ_user_ticket_restrictions_guildId_userId\` (\`guildId\`, \`userId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`user_ticket_restrictions\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`custom_ticket_types\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`pending_bans\``);
  }
}
