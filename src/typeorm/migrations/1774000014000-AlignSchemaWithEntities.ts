import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enhancedLogger, LogCategory } from '../../utils/monitoring/enhancedLogger';

interface ColumnInfo {
  dataType: string;
  maxLength: number | null;
  nullable: boolean;
  defaultValue: string | null;
  charset: string | null;
  collation: string | null;
}

interface WidenSpec {
  table: string;
  column: string;
  length: number;
  /** The entity default, restated because MODIFY replaces the whole column definition. */
  defaultValue?: string;
}

/** Columns real data outgrew at varchar(255). */
const WIDEN: WidenSpec[] = [
  // Signed Discord CDN URLs (?ex=&is=&hm=) pass 255 with a long filename.
  { table: 'starboard_entries', column: 'attachmentUrl', length: 2048 },
  // The dashboard and the bot route accept 500 / 1000 characters.
  {
    table: 'bait_channel_configs',
    column: 'banReason',
    length: 512,
    defaultValue: 'Posted in bait channel - Potential bot/scammer',
  },
  {
    table: 'bait_channel_configs',
    column: 'warningMessage',
    length: 1024,
    defaultValue: '⚠️ You have posted in a restricted channel. This channel is monitored for unauthorized access.',
  },
];

const OLD_VARCHAR_LENGTH = 255;

/** NOT NULL columns whose default only ever existed in the entity (dev synchronize). */
const DEFAULTS: Array<{ table: string; column: string; value: "''" | '0' }> = [
  ...['ticket_configs', 'application_configs', 'archived_ticket_configs', 'archived_application_configs'].flatMap(
    table => [
      { table, column: 'messageId', value: "''" as const },
      { table, column: 'channelId', value: "''" as const },
    ],
  ),
  { table: 'announcement_config', column: 'defaultChannelId', value: "''" },
  { table: 'bot_configs', column: 'enableGlobalStaffRole', value: '0' },
];

/** Indexes the entities declare that prod never got. Skipped when any index already leads with these columns. */
const INDEXES = [
  { table: 'tickets', name: 'IDX_tickets_guildId_channelId', columns: ['guildId', 'channelId'] },
  { table: 'announcement_log', name: 'IDX_announcement_log_guildId', columns: ['guildId'] },
];

const UNIQUE_TABLE = 'announcement_config';
const UNIQUE_NAME = 'UQ_announcement_config_guildId';

const SAFE_IDENT = /^\w+$/;

function warn(message: string): void {
  enhancedLogger.warn(`Migration AlignSchemaWithEntities: ${message}`, LogCategory.DATABASE);
}

function isDuplicateEntry(error: unknown): boolean {
  const e = error as { code?: string; errno?: number; driverError?: { code?: string } } | null;
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062 || e?.driverError?.code === 'ER_DUP_ENTRY';
}

/**
 * Brings prod (migrations only, `synchronize` off since v2.12.10) in line with
 * what the entities declare and what dev's `synchronize` already has. Every
 * step reads information_schema first and skips what is already in place, so
 * it is a no-op on dev and safe to re-run after a partial failure (MySQL DDL
 * commits implicitly, so a failed run leaves earlier steps applied). Nothing
 * here drops data:
 *
 * 1. Widen varchar columns: starboard_entries.attachmentUrl 255 → 2048,
 *    bait_channel_configs.banReason 255 → 512 and warningMessage 255 → 1024.
 *    Charset, collation, nullability and default are kept.
 * 2. Add the entity-only defaults on NOT NULL columns (messageId/channelId on
 *    the four panel config tables, announcement_config.defaultChannelId,
 *    bot_configs.enableGlobalStaffRole) so an insert that leaves them out works
 *    in prod as it does in dev.
 * 3. Create the declared indexes tickets (guildId, channelId) and
 *    announcement_log (guildId).
 * 4. Make announcement_config.guildId unique. If a guild already has two rows,
 *    log and skip instead of failing the boot (nothing is deleted).
 * 5. Data fix: voice/stage event templates that a failed `/event recurring`
 *    marked recurring (before voice/stage events got a channel) go back to
 *    isRecurring = 0, so a one-off event from the template can't start a chain.
 *
 * Known gap (not handled here): an empty database still can't be built from
 * migrations alone, because the pre-v3 tables only ever came from the old
 * `synchronize` baseline (1000000000000-InitialSchema is a no-op).
 */
export class AlignSchemaWithEntities1774000014000 implements MigrationInterface {
  name = 'AlignSchemaWithEntities1774000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const spec of WIDEN) {
      const col = await this.column(queryRunner, spec.table, spec.column);
      if (col?.dataType !== 'varchar' || (col.maxLength ?? 0) >= spec.length) continue;
      await this.modifyVarchar(queryRunner, spec, col, spec.length);
    }

    for (const { table, column, value } of DEFAULTS) {
      const col = await this.column(queryRunner, table, column);
      if (!col || col.defaultValue !== null) continue;
      await queryRunner.query(`ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` SET DEFAULT ${value}`);
    }

    for (const { table, name, columns } of INDEXES) {
      if (!(await queryRunner.hasTable(table))) continue;
      const indexes = await this.indexes(queryRunner, table);
      const covered = indexes.some(idx => columns.every((c, i) => idx.columns[i] === c));
      if (covered) continue;
      const cols = columns.map(c => `\`${c}\``).join(', ');
      await queryRunner.query(`CREATE INDEX \`${name}\` ON \`${table}\` (${cols})`);
    }

    await this.addUniqueGuildId(queryRunner);

    const isRecurring = await this.column(queryRunner, 'event_templates', 'isRecurring');
    const entityType = await this.column(queryRunner, 'event_templates', 'entityType');
    if (isRecurring && entityType) {
      const result = await queryRunner.query(
        "UPDATE `event_templates` SET `isRecurring` = 0 WHERE `isRecurring` = 1 AND `entityType` IN ('voice', 'stage')",
      );
      const fixed = Number(result?.affectedRows ?? 0);
      if (fixed > 0) {
        enhancedLogger.info(
          `Migration AlignSchemaWithEntities: reset isRecurring on ${fixed} voice/stage event template(s)`,
          LogCategory.DATABASE,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The event_templates data fix is not reversed: the flag it cleared was
    // left behind by a command that failed.

    if (await this.indexExists(queryRunner, UNIQUE_TABLE, UNIQUE_NAME)) {
      await queryRunner.query(`DROP INDEX \`${UNIQUE_NAME}\` ON \`${UNIQUE_TABLE}\``);
    }

    for (const { table, name } of INDEXES) {
      if (await this.indexExists(queryRunner, table, name)) {
        await queryRunner.query(`DROP INDEX \`${name}\` ON \`${table}\``);
      }
    }

    for (const { table, column } of DEFAULTS) {
      const col = await this.column(queryRunner, table, column);
      if (!col || col.defaultValue === null) continue;
      await queryRunner.query(`ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` DROP DEFAULT`);
    }

    for (const spec of WIDEN) {
      const col = await this.column(queryRunner, spec.table, spec.column);
      if (col?.dataType !== 'varchar' || (col.maxLength ?? 0) <= OLD_VARCHAR_LENGTH) continue;
      const rows = await queryRunner.query(
        `SELECT COALESCE(MAX(CHAR_LENGTH(\`${spec.column}\`)), 0) AS longest FROM \`${spec.table}\``,
      );
      const longest = Number(rows[0]?.longest ?? 0);
      if (longest > OLD_VARCHAR_LENGTH) {
        warn(`kept ${spec.table}.${spec.column} wide: a stored value is ${longest} characters`);
        continue;
      }
      await this.modifyVarchar(queryRunner, spec, col, OLD_VARCHAR_LENGTH);
    }
  }

  private async addUniqueGuildId(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(UNIQUE_TABLE))) return;
    const indexes = await this.indexes(queryRunner, UNIQUE_TABLE);
    if (indexes.some(idx => idx.unique && idx.columns.length === 1 && idx.columns[0] === 'guildId')) return;

    const dupes = await queryRunner.query(
      `SELECT COUNT(*) AS cnt FROM (SELECT \`guildId\` FROM \`${UNIQUE_TABLE}\` GROUP BY \`guildId\` HAVING COUNT(*) > 1) AS d`,
    );
    const dupeGuilds = Number(dupes[0]?.cnt ?? 0);
    if (dupeGuilds > 0) {
      warn(`skipped the unique index on ${UNIQUE_TABLE}.guildId: ${dupeGuilds} guild(s) have duplicate rows`);
      return;
    }

    try {
      await queryRunner.query(`CREATE UNIQUE INDEX \`${UNIQUE_NAME}\` ON \`${UNIQUE_TABLE}\` (\`guildId\`)`);
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      warn(`skipped the unique index on ${UNIQUE_TABLE}.guildId: a duplicate row appeared during the migration`);
    }
  }

  private async modifyVarchar(queryRunner: QueryRunner, spec: WidenSpec, col: ColumnInfo, length: number) {
    const charset = col.charset && SAFE_IDENT.test(col.charset) ? ` CHARACTER SET ${col.charset}` : '';
    const collate = col.collation && SAFE_IDENT.test(col.collation) ? ` COLLATE ${col.collation}` : '';
    const nullability = col.nullable ? 'NULL' : 'NOT NULL';
    const hasDefault = spec.defaultValue !== undefined;
    await queryRunner.query(
      `ALTER TABLE \`${spec.table}\` MODIFY \`${spec.column}\` varchar(${length})${charset}${collate} ${nullability}${hasDefault ? ' DEFAULT ?' : ''}`,
      hasDefault ? [spec.defaultValue] : undefined,
    );
  }

  private async column(queryRunner: QueryRunner, table: string, column: string): Promise<ColumnInfo | null> {
    const rows = await queryRunner.query(
      `SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength, IS_NULLABLE AS isNullable,
              COLUMN_DEFAULT AS defaultValue, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      dataType: String(row.dataType).toLowerCase(),
      maxLength: row.maxLength === null || row.maxLength === undefined ? null : Number(row.maxLength),
      nullable: row.isNullable === 'YES',
      defaultValue: row.defaultValue ?? null,
      charset: row.charset ?? null,
      collation: row.collation ?? null,
    };
  }

  private async indexes(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<Array<{ name: string; unique: boolean; columns: string[] }>> {
    const rows: Array<{ name: string; nonUnique: number | string; cols: string }> = await queryRunner.query(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       GROUP BY INDEX_NAME, NON_UNIQUE`,
      [table],
    );
    return rows.map(r => ({ name: r.name, unique: Number(r.nonUnique) === 0, columns: String(r.cols).split(',') }));
  }

  private async indexExists(queryRunner: QueryRunner, table: string, name: string): Promise<boolean> {
    if (!(await queryRunner.hasTable(table))) return false;
    return (await this.indexes(queryRunner, table)).some(idx => idx.name === name);
  }
}
