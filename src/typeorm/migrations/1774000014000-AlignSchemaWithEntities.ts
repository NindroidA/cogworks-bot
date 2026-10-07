import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enhancedLogger, LogCategory } from '../../utils/monitoring/enhancedLogger';

interface ColumnInfo {
  dataType: string;
  maxLength: number | null;
  nullable: boolean;
  defaultValue: string | null;
  /** An expression default (EXTRA = DEFAULT_GENERATED), which can't be restated as a literal. */
  expressionDefault: boolean;
  charset: string | null;
  collation: string | null;
}

interface WidenSpec {
  table: string;
  column: string;
  length: number;
  /** The entity default, used only when a NOT NULL column has no live default. */
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
const DEFAULTS: Array<{ table: string; column: string; value: '' | '0' }> = [
  ...['ticket_configs', 'application_configs', 'archived_ticket_configs', 'archived_application_configs'].flatMap(
    table => [
      { table, column: 'messageId', value: '' as const },
      { table, column: 'channelId', value: '' as const },
    ],
  ),
  { table: 'announcement_config', column: 'defaultChannelId', value: '' },
  { table: 'bot_configs', column: 'enableGlobalStaffRole', value: '0' },
];

/** Indexes the entities declare that prod never got. Skipped when any index already leads with these columns. */
const INDEXES = [
  { table: 'tickets', name: 'IDX_tickets_guildId_channelId', columns: ['guildId', 'channelId'] },
  { table: 'announcement_log', name: 'IDX_announcement_log_guildId', columns: ['guildId'] },
];

const UNIQUE_TABLE = 'announcement_config';
const UNIQUE_NAME = 'UQ_announcement_config_guildId';

/**
 * 2026-10-06T23:23:00Z, just before v3.16.32 (#73) merged and deployed. From
 * then on voice/stage templates get a channel, so a template marked recurring
 * after this can be a working series. Compared via FROM_UNIXTIME so the
 * session time zone reads it the same way it wrote `updatedAt`.
 */
const RECURRING_FIX_CUTOFF_UNIX = 1791328980;

/** The server default is a year: an ALTER queued behind a metadata lock would hang boot with the container still up. */
const LOCK_WAIT_TIMEOUT_SECONDS = 60;

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
 * it is safe to re-run after a partial failure (MySQL DDL commits implicitly,
 * so a failed run leaves earlier steps applied). Nothing here drops rows. The
 * session's lock_wait_timeout is capped at 60s while it runs, so a blocked
 * ALTER fails the boot (and the container retries) instead of hanging it.
 *
 * 1. Widen varchar columns: starboard_entries.attachmentUrl 255 → 2048,
 *    bait_channel_configs.banReason 255 → 512 and warningMessage 255 → 1024.
 *    Nullability and the live default are kept; a column whose collation
 *    differs from its table's keeps it explicitly.
 * 2. Add the entity-only defaults on NOT NULL columns (messageId/channelId on
 *    the four panel config tables, announcement_config.defaultChannelId,
 *    bot_configs.enableGlobalStaffRole) so an insert that leaves them out works
 *    in prod as it does in dev.
 * 3. Create the declared indexes tickets (guildId, channelId) and
 *    announcement_log (guildId).
 * 4. Make announcement_config.guildId unique. If a guild already has two rows,
 *    log and skip instead of failing the boot (nothing is deleted).
 * 5. Data fix: voice/stage event templates last saved before the v3.16.32
 *    deploy and still marked recurring were left that way by a failed
 *    `/event recurring` (they had no channel, so no event existed). They go
 *    back to isRecurring = 0, so a one-off event from the template can't start
 *    a chain.
 *
 * down() reverses steps 1-4 where the database still looks the way up() left
 * it: a column is narrowed only from exactly the widened length and only when
 * every value fits, keeping its live default; a default is dropped only when
 * it equals the value up() sets. It can't tell a default or width up() added
 * from one that was already there (a synchronized dev DB), so on such a DB it
 * removes those too. The data fix is not reversed.
 *
 * Known gap (not handled here): an empty database still can't be built from
 * migrations alone, because the pre-v3 tables only ever came from the old
 * `synchronize` baseline (1000000000000-InitialSchema is a no-op).
 */
export class AlignSchemaWithEntities1774000014000 implements MigrationInterface {
  name = 'AlignSchemaWithEntities1774000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.withLockWaitTimeout(queryRunner, () => this.apply(queryRunner));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.withLockWaitTimeout(queryRunner, () => this.revert(queryRunner));
  }

  private async apply(queryRunner: QueryRunner): Promise<void> {
    for (const spec of WIDEN) {
      const col = await this.column(queryRunner, spec.table, spec.column);
      if (col?.dataType !== 'varchar' || (col.maxLength ?? 0) >= spec.length) continue;
      await this.modifyVarchar(queryRunner, spec, col, spec.length, spec.defaultValue);
    }

    for (const { table, column, value } of DEFAULTS) {
      const col = await this.column(queryRunner, table, column);
      if (!col || col.nullable || col.defaultValue !== null) continue;
      await queryRunner.query(
        `ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` SET DEFAULT ${value === '' ? "''" : value}`,
      );
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
    await this.resetBrokenRecurringTemplates(queryRunner);
  }

  private async revert(queryRunner: QueryRunner): Promise<void> {
    if (await this.indexExists(queryRunner, UNIQUE_TABLE, UNIQUE_NAME)) {
      await queryRunner.query(`DROP INDEX \`${UNIQUE_NAME}\` ON \`${UNIQUE_TABLE}\``);
    }

    for (const { table, name } of INDEXES) {
      if (await this.indexExists(queryRunner, table, name)) {
        await queryRunner.query(`DROP INDEX \`${name}\` ON \`${table}\``);
      }
    }

    for (const { table, column, value } of DEFAULTS) {
      const col = await this.column(queryRunner, table, column);
      if (col?.defaultValue !== value) continue;
      await queryRunner.query(`ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` DROP DEFAULT`);
    }

    for (const spec of WIDEN) {
      const col = await this.column(queryRunner, spec.table, spec.column);
      if (col?.dataType !== 'varchar' || col.maxLength !== spec.length) continue;
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

  private async withLockWaitTimeout(queryRunner: QueryRunner, run: () => Promise<void>): Promise<void> {
    const rows = await queryRunner.query('SELECT @@SESSION.lock_wait_timeout AS v');
    const previous = Number(rows[0]?.v);
    await queryRunner.query(`SET SESSION lock_wait_timeout = ${LOCK_WAIT_TIMEOUT_SECONDS}`);
    try {
      await run();
    } finally {
      if (Number.isInteger(previous) && previous > 0) {
        try {
          await queryRunner.query(`SET SESSION lock_wait_timeout = ${previous}`);
        } catch (error) {
          warn(`could not restore lock_wait_timeout to ${previous}: ${(error as Error).message}`);
        }
      }
    }
  }

  private async resetBrokenRecurringTemplates(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['isRecurring', 'entityType', 'updatedAt']) {
      if (!(await this.column(queryRunner, 'event_templates', column))) return;
    }
    const result = await queryRunner.query(
      "UPDATE `event_templates` SET `isRecurring` = 0 WHERE `isRecurring` = 1 AND `entityType` IN ('voice', 'stage')" +
        ` AND \`updatedAt\` < FROM_UNIXTIME(${RECURRING_FIX_CUTOFF_UNIX})`,
    );
    const fixed = Number(result?.affectedRows ?? 0);
    if (fixed > 0) {
      enhancedLogger.info(
        `Migration AlignSchemaWithEntities: reset isRecurring on ${fixed} voice/stage event template(s)`,
        LogCategory.DATABASE,
      );
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

  /**
   * MODIFY replaces the whole column definition, so restate what is live:
   * nullability, the live default (or `fallbackDefault` for a NOT NULL column
   * with none), and the collation when it differs from the table's (restating
   * an inherited one would pin it as explicit).
   */
  private async modifyVarchar(
    queryRunner: QueryRunner,
    spec: WidenSpec,
    col: ColumnInfo,
    length: number,
    fallbackDefault?: string,
  ): Promise<void> {
    if (col.expressionDefault) {
      warn(`left ${spec.table}.${spec.column} as is: it has an expression default`);
      return;
    }
    const tableCollation = await this.tableCollation(queryRunner, spec.table);
    const ownCollation =
      col.collation !== null &&
      col.collation !== tableCollation &&
      SAFE_IDENT.test(col.collation) &&
      SAFE_IDENT.test(col.charset ?? '');
    const collate = ownCollation ? ` CHARACTER SET ${col.charset} COLLATE ${col.collation}` : '';
    const defaultValue = col.defaultValue ?? (col.nullable ? undefined : fallbackDefault);
    await queryRunner.query(
      `ALTER TABLE \`${spec.table}\` MODIFY \`${spec.column}\` varchar(${length})${collate} ${col.nullable ? 'NULL' : 'NOT NULL'}${defaultValue === undefined ? '' : ' DEFAULT ?'}`,
      defaultValue === undefined ? undefined : [defaultValue],
    );
  }

  private async column(queryRunner: QueryRunner, table: string, column: string): Promise<ColumnInfo | null> {
    const rows = await queryRunner.query(
      `SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength, IS_NULLABLE AS isNullable,
              COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
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
      expressionDefault: /DEFAULT_GENERATED/i.test(String(row.extra ?? '')),
      charset: row.charset ?? null,
      collation: row.collation ?? null,
    };
  }

  private async tableCollation(queryRunner: QueryRunner, table: string): Promise<string | null> {
    const rows = await queryRunner.query(
      'SELECT TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table],
    );
    return rows[0]?.collation ?? null;
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
