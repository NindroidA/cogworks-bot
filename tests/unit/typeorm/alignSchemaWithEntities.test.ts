import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { QueryRunner } from 'typeorm';
import { AlignSchemaWithEntities1774000014000 } from '../../../src/typeorm/migrations/1774000014000-AlignSchemaWithEntities';
import { enhancedLogger } from '../../../src/utils/monitoring/enhancedLogger';

// ---------------------------------------------------------------------------
// Fake queryRunner: answers the information_schema reads from an in-memory
// description of the database and records every other statement.
// ---------------------------------------------------------------------------

interface FakeColumn {
  dataType: string;
  maxLength: number | null;
  isNullable: 'YES' | 'NO';
  defaultValue: string | null;
  extra: string;
  charset: string | null;
  collation: string | null;
}

interface FakeIndex {
  name: string;
  nonUnique: number;
  cols: string;
}

interface FakeDb {
  tables: Set<string>;
  columns: Map<string, FakeColumn>;
  indexes: Map<string, FakeIndex[]>;
  dupeGuilds: number;
  longest: Map<string, number>;
  brokenTemplates: number;
  createUniqueError?: unknown;
}

const TABLE_COLLATION = 'utf8mb4_0900_ai_ci';
const SERVER_LOCK_WAIT_TIMEOUT = 31536000;
const ENTITY_WARNING = '⚠️ You have posted in a restricted channel. This channel is monitored for unauthorized access.';
const DATA_FIX =
  "UPDATE `event_templates` SET `isRecurring` = 0 WHERE `isRecurring` = 1 AND `entityType` IN ('voice', 'stage')" +
  ' AND `updatedAt` < FROM_UNIXTIME(1791328980)';

const PANEL_TABLES = [
  'ticket_configs',
  'application_configs',
  'archived_ticket_configs',
  'archived_application_configs',
];
const DEFAULT_COLUMNS = [
  ...PANEL_TABLES.flatMap(t => [`${t}.messageId`, `${t}.channelId`]),
  'announcement_config.defaultChannelId',
  'bot_configs.enableGlobalStaffRole',
];

function varchar(length: number, nullable: boolean, defaultValue: string | null = null): FakeColumn {
  return {
    dataType: 'varchar',
    maxLength: length,
    isNullable: nullable ? 'YES' : 'NO',
    defaultValue,
    extra: '',
    charset: 'utf8mb4',
    collation: TABLE_COLLATION,
  };
}

function other(dataType: string, defaultValue: string | null = null): FakeColumn {
  return { ...varchar(0, false, defaultValue), dataType, maxLength: null, charset: null, collation: null };
}

/** The live prod shape: 255-wide columns, no defaults, missing indexes, broken voice templates. */
function prodDb(): FakeDb {
  const columns = new Map<string, FakeColumn>([
    ['starboard_entries.attachmentUrl', varchar(255, true)],
    ['bait_channel_configs.banReason', varchar(255, false, 'Posted in bait channel - Potential bot/scammer')],
    ['bait_channel_configs.warningMessage', varchar(255, false, ENTITY_WARNING)],
    ['event_templates.isRecurring', other('tinyint', '0')],
    ['event_templates.entityType', varchar(20, false, 'external')],
    ['event_templates.updatedAt', other('datetime', 'CURRENT_TIMESTAMP(6)')],
  ]);
  for (const key of DEFAULT_COLUMNS) {
    columns.set(key, key.endsWith('enableGlobalStaffRole') ? other('tinyint') : varchar(255, false));
  }
  return {
    tables: new Set([
      'starboard_entries',
      'bait_channel_configs',
      'event_templates',
      'tickets',
      'announcement_log',
      'announcement_config',
      'bot_configs',
      ...PANEL_TABLES,
    ]),
    columns,
    indexes: new Map([
      [
        'tickets',
        [
          { name: 'PRIMARY', nonUnique: 0, cols: 'id' },
          { name: 'IDX_0f8a2b', nonUnique: 1, cols: 'guildId,status' },
          { name: 'IDX_tickets_guildId_createdBy', nonUnique: 1, cols: 'guildId,createdBy' },
        ],
      ],
      ['announcement_log', [{ name: 'PRIMARY', nonUnique: 0, cols: 'id' }]],
      [
        'announcement_config',
        [
          { name: 'PRIMARY', nonUnique: 0, cols: 'id' },
          { name: 'IDX_9c1d4e', nonUnique: 1, cols: 'guildId' },
        ],
      ],
    ]),
    dupeGuilds: 0,
    longest: new Map(),
    brokenTemplates: 2,
  };
}

/** What a completed up() (or dev's synchronize) leaves behind. */
function alignedDb(): FakeDb {
  const db = prodDb();
  db.columns.set('starboard_entries.attachmentUrl', varchar(2048, true));
  db.columns.set(
    'bait_channel_configs.banReason',
    varchar(512, false, 'Posted in bait channel - Potential bot/scammer'),
  );
  db.columns.set('bait_channel_configs.warningMessage', varchar(1024, false, ENTITY_WARNING));
  for (const key of DEFAULT_COLUMNS) {
    const col = db.columns.get(key)!;
    db.columns.set(key, { ...col, defaultValue: key.endsWith('enableGlobalStaffRole') ? '0' : '' });
  }
  db.indexes.get('tickets')!.push({ name: 'IDX_tickets_guildId_channelId', nonUnique: 1, cols: 'guildId,channelId' });
  db.indexes.get('announcement_log')!.push({ name: 'IDX_announcement_log_guildId', nonUnique: 1, cols: 'guildId' });
  db.indexes
    .get('announcement_config')!
    .push({ name: 'UQ_announcement_config_guildId', nonUnique: 0, cols: 'guildId' });
  db.brokenTemplates = 0;
  return db;
}

function makeRunner(db: FakeDb) {
  const writes: Array<{ sql: string; params?: unknown[] }> = [];
  const sessions: string[] = [];
  const runner = {
    hasTable: async (table: string) => db.tables.has(table),
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('information_schema.COLUMNS')) {
        const [table, column] = params as string[];
        const col = db.tables.has(table) ? db.columns.get(`${table}.${column}`) : undefined;
        return col ? [{ ...col }] : [];
      }
      if (sql.includes('information_schema.TABLES')) {
        return db.tables.has((params as string[])[0]) ? [{ collation: TABLE_COLLATION }] : [];
      }
      if (sql.includes('information_schema.STATISTICS')) {
        return db.indexes.get((params as string[])[0]) ?? [];
      }
      if (sql.includes('@@SESSION.lock_wait_timeout')) return [{ v: SERVER_LOCK_WAIT_TIMEOUT }];
      if (sql.startsWith('SET SESSION')) {
        sessions.push(sql);
        return [];
      }
      if (sql.includes('HAVING COUNT(*) > 1')) return [{ cnt: db.dupeGuilds }];
      const longest = sql.match(/CHAR_LENGTH\(`(\w+)`\)\), 0\) AS longest FROM `(\w+)`/);
      if (longest) return [{ longest: db.longest.get(`${longest[2]}.${longest[1]}`) ?? 0 }];

      writes.push({ sql, params });
      if (sql.startsWith('UPDATE')) return { affectedRows: db.brokenTemplates };
      if (sql.startsWith('CREATE UNIQUE INDEX') && db.createUniqueError) throw db.createUniqueError;
      return [];
    },
  };
  return { runner: runner as unknown as QueryRunner, writes, sessions, sqls: () => writes.map(w => w.sql) };
}

const migration = new AlignSchemaWithEntities1774000014000();
let warnSpy: ReturnType<typeof jest.spyOn>;
let infoSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  warnSpy = jest.spyOn(enhancedLogger, 'warn').mockImplementation(() => {});
  infoSpy = jest.spyOn(enhancedLogger, 'info').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  infoSpy.mockRestore();
});

describe('AlignSchemaWithEntities up()', () => {
  test('on the prod shape: widens, adds defaults, creates indexes and the unique key, fixes templates', async () => {
    const { runner, sqls } = makeRunner(prodDb());
    await migration.up(runner);
    const run = sqls();

    expect(run).toContain('ALTER TABLE `starboard_entries` MODIFY `attachmentUrl` varchar(2048) NULL');
    expect(run.filter(s => s.startsWith('ALTER TABLE `bait_channel_configs` MODIFY'))).toHaveLength(2);
    for (const key of DEFAULT_COLUMNS) {
      const [table, column] = key.split('.');
      const value = column === 'enableGlobalStaffRole' ? '0' : "''";
      expect(run).toContain(`ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` SET DEFAULT ${value}`);
    }
    expect(run).toContain('CREATE INDEX `IDX_tickets_guildId_channelId` ON `tickets` (`guildId`, `channelId`)');
    expect(run).toContain('CREATE INDEX `IDX_announcement_log_guildId` ON `announcement_log` (`guildId`)');
    expect(run).toContain('CREATE UNIQUE INDEX `UQ_announcement_config_guildId` ON `announcement_config` (`guildId`)');
    expect(run).toContain(DATA_FIX);
    expect(run).toHaveLength(3 + DEFAULT_COLUMNS.length + 2 + 1 + 1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    // Nothing destructive.
    expect(run.some(s => /DROP|DELETE|TRUNCATE/i.test(s))).toBe(false);
  });

  test('caps lock_wait_timeout at 60s for the run and restores the session value after', async () => {
    const { runner, sessions } = makeRunner(prodDb());
    await migration.up(runner);
    expect(sessions).toEqual([
      'SET SESSION lock_wait_timeout = 60',
      `SET SESSION lock_wait_timeout = ${SERVER_LOCK_WAIT_TIMEOUT}`,
    ]);
  });

  test('restores lock_wait_timeout even when a step fails', async () => {
    const db = prodDb();
    db.createUniqueError = Object.assign(new Error('Lock wait timeout exceeded'), {
      code: 'ER_LOCK_WAIT_TIMEOUT',
      errno: 1205,
    });
    const { runner, sessions } = makeRunner(db);
    await expect(migration.up(runner)).rejects.toThrow('Lock wait timeout exceeded');
    expect(sessions.at(-1)).toBe(`SET SESSION lock_wait_timeout = ${SERVER_LOCK_WAIT_TIMEOUT}`);
  });

  test('MODIFY keeps the live default, nullability and an inherited collation implicit', async () => {
    const db = prodDb();
    db.columns.set('bait_channel_configs.banReason', varchar(255, false, 'Custom live default'));
    const { runner, writes } = makeRunner(db);
    await migration.up(runner);
    const banReason = writes.find(w => w.sql.includes('MODIFY `banReason`'));
    expect(banReason?.sql).toBe(
      'ALTER TABLE `bait_channel_configs` MODIFY `banReason` varchar(512) NOT NULL DEFAULT ?',
    );
    expect(banReason?.params).toEqual(['Custom live default']);
    const url = writes.find(w => w.sql.includes('MODIFY `attachmentUrl`'));
    expect(url?.params).toBeUndefined();
  });

  test('a NOT NULL column without a live default gets the entity default; a nullable one keeps NULL', async () => {
    const db = prodDb();
    db.columns.set('bait_channel_configs.warningMessage', varchar(255, false, null));
    db.columns.set('bait_channel_configs.banReason', varchar(300, true, null));
    const { runner, writes } = makeRunner(db);
    await migration.up(runner);
    expect(writes.find(w => w.sql.includes('MODIFY `warningMessage`'))?.params).toEqual([ENTITY_WARNING]);
    const banReason = writes.find(w => w.sql.includes('MODIFY `banReason`'));
    expect(banReason?.sql).toBe('ALTER TABLE `bait_channel_configs` MODIFY `banReason` varchar(512) NULL');
  });

  test('restates a collation that differs from the table default', async () => {
    const db = prodDb();
    db.columns.set('starboard_entries.attachmentUrl', {
      ...varchar(255, true),
      charset: 'latin1',
      collation: 'latin1_bin',
    });
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls()).toContain(
      'ALTER TABLE `starboard_entries` MODIFY `attachmentUrl` varchar(2048) CHARACTER SET latin1 COLLATE latin1_bin NULL',
    );
  });

  test('a column with an expression default is left alone, with a warning', async () => {
    const db = prodDb();
    db.columns.set('bait_channel_configs.banReason', {
      ...varchar(255, false, "concat('a','b')"),
      extra: 'DEFAULT_GENERATED',
    });
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls().some(s => s.includes('MODIFY `banReason`'))).toBe(false);
    expect(String(warnSpy.mock.calls[0][0])).toContain('expression default');
  });

  test('the data fix only resets templates last saved before the v3.16.32 deploy', async () => {
    const { runner, sqls } = makeRunner(prodDb());
    await migration.up(runner);
    const update = sqls().find(s => s.startsWith('UPDATE `event_templates`'));
    expect(update).toContain('AND `updatedAt` < FROM_UNIXTIME(1791328980)');
    // The cutoff is 2026-10-06T23:23:00Z, just before #73 merged (23:23:05Z).
    expect(Date.parse('2026-10-06T23:23:00Z') / 1000).toBe(1791328980);
  });

  test('the data fix is skipped when event_templates has no updatedAt column', async () => {
    const db = prodDb();
    db.columns.delete('event_templates.updatedAt');
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls().some(s => s.startsWith('UPDATE'))).toBe(false);
  });

  test('is a no-op on an aligned (dev / already migrated) database apart from the zero-row data fix', async () => {
    const { runner, sqls } = makeRunner(alignedDb());
    await migration.up(runner);
    expect(sqls()).toEqual([DATA_FIX]);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('an index that already leads with the columns counts, whatever its name', async () => {
    const db = prodDb();
    db.indexes.get('tickets')!.push({ name: 'IDX_typeorm_hash', nonUnique: 1, cols: 'guildId,channelId,status' });
    db.indexes.get('announcement_log')!.push({ name: 'IDX_other', nonUnique: 1, cols: 'guildId,sentAt' });
    db.indexes.get('announcement_config')!.push({ name: 'IDX_typeorm_unique', nonUnique: 0, cols: 'guildId' });
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls().some(s => s.startsWith('CREATE'))).toBe(false);
  });

  test('a composite unique key does not count as unique guildId', async () => {
    const db = prodDb();
    db.indexes.get('announcement_config')!.push({ name: 'UQ_pair', nonUnique: 0, cols: 'guildId,defaultRoleId' });
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls()).toContain(
      'CREATE UNIQUE INDEX `UQ_announcement_config_guildId` ON `announcement_config` (`guildId`)',
    );
  });

  test('duplicate guild rows: skips the unique key, logs, deletes nothing, finishes the rest', async () => {
    const db = prodDb();
    db.dupeGuilds = 3;
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    const run = sqls();
    expect(run.some(s => s.startsWith('CREATE UNIQUE INDEX'))).toBe(false);
    expect(run.some(s => /DELETE/i.test(s))).toBe(false);
    expect(run.some(s => s.startsWith('UPDATE `event_templates`'))).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('3 guild(s) have duplicate rows');
  });

  test('a duplicate that appears during the migration is logged and skipped, not fatal', async () => {
    const db = prodDb();
    db.createUniqueError = Object.assign(new Error("Duplicate entry '1' for key"), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(sqls().some(s => s.startsWith('UPDATE `event_templates`'))).toBe(true);
  });

  test('a nullable column (DEFAULT NULL) is not given a default', async () => {
    const db = prodDb();
    db.columns.set('ticket_configs.messageId', varchar(255, true, null));
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls().some(s => s.includes('`ticket_configs` ALTER COLUMN `messageId`'))).toBe(false);
  });

  test('missing tables and columns are skipped', async () => {
    const db = prodDb();
    db.tables = new Set();
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls()).toEqual([]);
  });

  test('a column that is already text is left alone', async () => {
    const db = prodDb();
    db.columns.set('starboard_entries.attachmentUrl', { ...varchar(0, true), dataType: 'text', maxLength: 65535 });
    const { runner, sqls } = makeRunner(db);
    await migration.up(runner);
    expect(sqls().some(s => s.includes('`attachmentUrl`'))).toBe(false);
  });
});

describe('AlignSchemaWithEntities down()', () => {
  test('reverts indexes, defaults and widths when the data fits', async () => {
    const { runner, sqls, sessions } = makeRunner(alignedDb());
    await migration.down(runner);
    const run = sqls();
    expect(run).toContain('DROP INDEX `UQ_announcement_config_guildId` ON `announcement_config`');
    expect(run).toContain('DROP INDEX `IDX_tickets_guildId_channelId` ON `tickets`');
    expect(run).toContain('DROP INDEX `IDX_announcement_log_guildId` ON `announcement_log`');
    expect(run.filter(s => s.endsWith('DROP DEFAULT'))).toHaveLength(DEFAULT_COLUMNS.length);
    expect(run).toContain('ALTER TABLE `starboard_entries` MODIFY `attachmentUrl` varchar(255) NULL');
    expect(run.filter(s => s.includes('MODIFY') && s.includes('varchar(255)'))).toHaveLength(3);
    expect(run.some(s => s.startsWith('UPDATE') || /DELETE|TRUNCATE/i.test(s))).toBe(false);
    expect(sessions).toHaveLength(2);
  });

  test('narrows only from exactly the widened length and keeps the live default', async () => {
    const db = alignedDb();
    db.columns.set('starboard_entries.attachmentUrl', varchar(4096, false, ''));
    db.columns.set('bait_channel_configs.banReason', varchar(512, false, 'Custom live default'));
    const { runner, writes } = makeRunner(db);
    await migration.down(runner);
    expect(writes.some(w => w.sql.includes('`attachmentUrl`'))).toBe(false);
    const banReason = writes.find(w => w.sql.includes('MODIFY `banReason`'));
    expect(banReason?.sql).toBe(
      'ALTER TABLE `bait_channel_configs` MODIFY `banReason` varchar(255) NOT NULL DEFAULT ?',
    );
    expect(banReason?.params).toEqual(['Custom live default']);
  });

  test('drops only defaults equal to the value up() sets', async () => {
    const db = alignedDb();
    db.columns.set('ticket_configs.channelId', varchar(255, false, 'keep'));
    const { runner, sqls } = makeRunner(db);
    await migration.down(runner);
    expect(sqls().some(s => s.includes('`ticket_configs` ALTER COLUMN `channelId`'))).toBe(false);
    expect(sqls().filter(s => s.endsWith('DROP DEFAULT'))).toHaveLength(DEFAULT_COLUMNS.length - 1);
  });

  test('keeps a column wide when a stored value would not fit back in 255', async () => {
    const db = alignedDb();
    db.longest.set('starboard_entries.attachmentUrl', 412);
    const { runner, sqls } = makeRunner(db);
    await migration.down(runner);
    expect(sqls().some(s => s.includes('MODIFY `attachmentUrl`'))).toBe(false);
    expect(sqls().filter(s => s.includes('MODIFY'))).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('does nothing on a database up() never touched', async () => {
    const { runner, sqls } = makeRunner(prodDb());
    await migration.down(runner);
    expect(sqls()).toEqual([]);
  });
});
