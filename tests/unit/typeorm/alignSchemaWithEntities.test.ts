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
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_ai_ci',
  };
}

/** The live prod shape: 255-wide columns, no defaults, missing indexes, broken voice templates. */
function prodDb(): FakeDb {
  const columns = new Map<string, FakeColumn>([
    ['starboard_entries.attachmentUrl', varchar(255, true)],
    ['bait_channel_configs.banReason', varchar(255, false, 'Posted in bait channel - Potential bot/scammer')],
    ['bait_channel_configs.warningMessage', varchar(255, false, '⚠️ You have posted in a restricted channel.')],
    ['event_templates.isRecurring', { ...varchar(0, false, '0'), dataType: 'tinyint', maxLength: null }],
    ['event_templates.entityType', varchar(20, false, 'external')],
  ]);
  for (const key of DEFAULT_COLUMNS) {
    columns.set(
      key,
      key.endsWith('enableGlobalStaffRole')
        ? { ...varchar(0, false), dataType: 'tinyint', maxLength: null }
        : varchar(255, false),
    );
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

/** What dev's synchronize (or a completed up()) leaves behind. */
function alignedDb(): FakeDb {
  const db = prodDb();
  db.columns.set('starboard_entries.attachmentUrl', varchar(2048, true));
  db.columns.set(
    'bait_channel_configs.banReason',
    varchar(512, false, 'Posted in bait channel - Potential bot/scammer'),
  );
  db.columns.set('bait_channel_configs.warningMessage', varchar(1024, false, '⚠️ You have posted.'));
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
  const runner = {
    hasTable: async (table: string) => db.tables.has(table),
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('information_schema.COLUMNS')) {
        const [table, column] = params as string[];
        const col = db.tables.has(table) ? db.columns.get(`${table}.${column}`) : undefined;
        return col ? [{ ...col }] : [];
      }
      if (sql.includes('information_schema.STATISTICS')) {
        return db.indexes.get((params as string[])[0]) ?? [];
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
  return { runner: runner as unknown as QueryRunner, writes, sqls: () => writes.map(w => w.sql) };
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

    expect(run).toContain(
      'ALTER TABLE `starboard_entries` MODIFY `attachmentUrl` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL',
    );
    expect(run.filter(s => s.startsWith('ALTER TABLE `bait_channel_configs` MODIFY'))).toHaveLength(2);
    for (const key of DEFAULT_COLUMNS) {
      const [table, column] = key.split('.');
      const value = column === 'enableGlobalStaffRole' ? '0' : "''";
      expect(run).toContain(`ALTER TABLE \`${table}\` ALTER COLUMN \`${column}\` SET DEFAULT ${value}`);
    }
    expect(run).toContain('CREATE INDEX `IDX_tickets_guildId_channelId` ON `tickets` (`guildId`, `channelId`)');
    expect(run).toContain('CREATE INDEX `IDX_announcement_log_guildId` ON `announcement_log` (`guildId`)');
    expect(run).toContain('CREATE UNIQUE INDEX `UQ_announcement_config_guildId` ON `announcement_config` (`guildId`)');
    expect(run).toContain(
      "UPDATE `event_templates` SET `isRecurring` = 0 WHERE `isRecurring` = 1 AND `entityType` IN ('voice', 'stage')",
    );
    expect(run).toHaveLength(3 + DEFAULT_COLUMNS.length + 2 + 1 + 1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    // Nothing destructive.
    expect(run.some(s => /DROP|DELETE|TRUNCATE/i.test(s))).toBe(false);
  });

  test('MODIFY restates charset, collation, NOT NULL and the entity default', async () => {
    const { runner, writes } = makeRunner(prodDb());
    await migration.up(runner);
    const banReason = writes.find(w => w.sql.includes('MODIFY `banReason`'));
    expect(banReason?.sql).toBe(
      'ALTER TABLE `bait_channel_configs` MODIFY `banReason` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT ?',
    );
    expect(banReason?.params).toEqual(['Posted in bait channel - Potential bot/scammer']);
    const warning = writes.find(w => w.sql.includes('MODIFY `warningMessage`'));
    expect(warning?.sql).toContain('varchar(1024)');
    expect(warning?.params).toEqual([
      '⚠️ You have posted in a restricted channel. This channel is monitored for unauthorized access.',
    ]);
  });

  test('is a no-op on an aligned (dev / already migrated) database apart from the zero-row data fix', async () => {
    const { runner, sqls } = makeRunner(alignedDb());
    await migration.up(runner);
    expect(sqls()).toEqual([
      "UPDATE `event_templates` SET `isRecurring` = 0 WHERE `isRecurring` = 1 AND `entityType` IN ('voice', 'stage')",
    ]);
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

  test('any other error creating the unique key still fails the migration', async () => {
    const db = prodDb();
    db.createUniqueError = Object.assign(new Error('Lock wait timeout'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 });
    const { runner } = makeRunner(db);
    await expect(migration.up(runner)).rejects.toThrow('Lock wait timeout');
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
    const { runner, sqls } = makeRunner(alignedDb());
    await migration.down(runner);
    const run = sqls();
    expect(run).toContain('DROP INDEX `UQ_announcement_config_guildId` ON `announcement_config`');
    expect(run).toContain('DROP INDEX `IDX_tickets_guildId_channelId` ON `tickets`');
    expect(run).toContain('DROP INDEX `IDX_announcement_log_guildId` ON `announcement_log`');
    expect(run.filter(s => s.endsWith('DROP DEFAULT'))).toHaveLength(DEFAULT_COLUMNS.length);
    expect(run).toContain(
      'ALTER TABLE `starboard_entries` MODIFY `attachmentUrl` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL',
    );
    expect(run.filter(s => s.includes('MODIFY') && s.includes('varchar(255)'))).toHaveLength(3);
    expect(run.some(s => s.startsWith('UPDATE') || /DELETE|TRUNCATE/i.test(s))).toBe(false);
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
