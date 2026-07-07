import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `forumTagIds` simple-json column to `archived_applications`,
 * mirroring `ArchivedTicket.forumTagIds`. Stores the forum tags applied to an
 * application's archive thread (position + Accepted/Rejected outcome) so
 * re-closes accumulate onto the existing set (v3.16.1).
 *
 * Nullable to stay backfill-friendly: rows written before this column existed
 * keep NULL, which the close workflow treats as "no tags yet". Dev
 * (`synchronize: true`) picks the decorator up automatically; this migration
 * covers prod.
 */
export class AddArchivedApplicationForumTags1774000013000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`archived_applications\` ADD \`forumTagIds\` text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`archived_applications\` DROP COLUMN \`forumTagIds\``);
  }
}
