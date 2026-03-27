import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-channel memory system migration.
 *
 * Changes:
 * - Removes unique constraint on memory_configs.guildId (allows multiple configs per guild)
 * - Adds channelName and sortOrder columns to memory_configs
 * - Adds memoryConfigId column to memory_tags and memory_items
 * - Backfills memoryConfigId on existing tags/items
 * - Adds new indexes for multi-channel queries
 */
export class MultiChannelMemory1773170057000 implements MigrationInterface {
  name = 'MultiChannelMemory1773170057000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop unique constraint on memory_configs.guildId
    // MySQL creates an index for unique constraints — find and drop it
    const indexes = await queryRunner.query(
      `SHOW INDEX FROM \`memory_configs\` WHERE Column_name = 'guildId' AND Non_unique = 0`,
    );
    for (const idx of indexes) {
      if (idx.Key_name !== 'PRIMARY') {
        await queryRunner.query(`ALTER TABLE \`memory_configs\` DROP INDEX \`${idx.Key_name}\``);
      }
    }

    // 2. Add channelName column (default 'Memory' for existing rows)
    await queryRunner.query(
      `ALTER TABLE \`memory_configs\` ADD \`channelName\` varchar(100) NOT NULL DEFAULT 'Memory'`,
    );

    // 3. Add sortOrder column
    await queryRunner.query(`ALTER TABLE \`memory_configs\` ADD \`sortOrder\` int NOT NULL DEFAULT 0`);

    // 4. Add guildId index (was implicit from unique, now explicit)
    await queryRunner.query(`CREATE INDEX \`IDX_memory_configs_guildId\` ON \`memory_configs\` (\`guildId\`)`);

    // 5. Add memoryConfigId to memory_tags (nullable first for backfill)
    await queryRunner.query(`ALTER TABLE \`memory_tags\` ADD \`memoryConfigId\` int NULL`);

    // 6. Add memoryConfigId to memory_items (nullable first for backfill)
    await queryRunner.query(`ALTER TABLE \`memory_items\` ADD \`memoryConfigId\` int NULL`);

    // 7. Backfill: set memoryConfigId on existing tags to their guild's config id
    await queryRunner.query(`
      UPDATE \`memory_tags\` t
      INNER JOIN \`memory_configs\` c ON t.guildId = c.guildId
      SET t.memoryConfigId = c.id
    `);

    // 8. Backfill: set memoryConfigId on existing items to their guild's config id
    await queryRunner.query(`
      UPDATE \`memory_items\` i
      INNER JOIN \`memory_configs\` c ON i.guildId = c.guildId
      SET i.memoryConfigId = c.id
    `);

    // 9. Make memoryConfigId NOT NULL after backfill
    await queryRunner.query(`ALTER TABLE \`memory_tags\` MODIFY \`memoryConfigId\` int NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`memory_items\` MODIFY \`memoryConfigId\` int NOT NULL`);

    // 10. Drop old guildId+tagType index on memory_tags, add new composite
    const tagIndexes = await queryRunner.query(`SHOW INDEX FROM \`memory_tags\` WHERE Column_name = 'tagType'`);
    for (const idx of tagIndexes) {
      await queryRunner.query(`ALTER TABLE \`memory_tags\` DROP INDEX \`${idx.Key_name}\``);
    }

    await queryRunner.query(
      `CREATE INDEX \`IDX_memory_tags_guild_config_type\` ON \`memory_tags\` (\`guildId\`, \`memoryConfigId\`, \`tagType\`)`,
    );

    // 11. Add memoryConfigId index on memory_items
    await queryRunner.query(
      `CREATE INDEX \`IDX_memory_items_guild_config\` ON \`memory_items\` (\`guildId\`, \`memoryConfigId\`)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Remove new indexes
    await queryRunner.query(`DROP INDEX \`IDX_memory_items_guild_config\` ON \`memory_items\``);
    await queryRunner.query(`DROP INDEX \`IDX_memory_tags_guild_config_type\` ON \`memory_tags\``);

    // Restore old guildId+tagType index
    await queryRunner.query(
      `CREATE INDEX \`IDX_memory_tags_guildId_tagType\` ON \`memory_tags\` (\`guildId\`, \`tagType\`)`,
    );

    // Remove memoryConfigId columns
    await queryRunner.query(`ALTER TABLE \`memory_items\` DROP COLUMN \`memoryConfigId\``);
    await queryRunner.query(`ALTER TABLE \`memory_tags\` DROP COLUMN \`memoryConfigId\``);

    // Remove guildId index
    await queryRunner.query(`DROP INDEX \`IDX_memory_configs_guildId\` ON \`memory_configs\``);

    // Remove sortOrder and channelName columns
    await queryRunner.query(`ALTER TABLE \`memory_configs\` DROP COLUMN \`sortOrder\``);
    await queryRunner.query(`ALTER TABLE \`memory_configs\` DROP COLUMN \`channelName\``);

    // Restore unique constraint on guildId
    await queryRunner.query(
      `ALTER TABLE \`memory_configs\` ADD UNIQUE INDEX \`IDX_memory_configs_guildId_unique\` (\`guildId\`)`,
    );
  }
}
