/**
 * ImportManager (NindroidA/cogworks-bot#41, findings #108 and #110).
 *
 * Before: an import reported success without writing any XP, dry runs started
 * the 1-hour cooldown, and parsed records sat on importer fields shared by
 * every guild. Now the records travel with the call into the XP writer, only a
 * written import is logged 'completed', and a failed write is logged 'failed'.
 *
 * Patches AppDataSource.getRepository for the ImportLog repo (restored in afterAll).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { lang } from '../../../../src/lang';
import { AppDataSource } from '../../../../src/typeorm';
import { ImportManager } from '../../../../src/utils/import/importManager';
import type { BotImporter, ImportOptions, ImportResult, RawXpRecord } from '../../../../src/utils/import/types';
import {
  writeImportedXp,
  XP_WRITE_CHUNK_SIZE,
  type XpImportStore,
  type XpImportTransaction,
} from '../../../../src/utils/import/xpWriter';

type GetRepository = (entity: unknown) => unknown;

const logs: any[] = [];
const fakeLogRepo = {
  create: (data: Record<string, unknown>) => ({ importedCount: 0, skippedCount: 0, failedCount: 0, ...data }),
  async save(entity: any) {
    if (!logs.includes(entity)) {
      entity.id = logs.length + 1; // assigned on insert, like the database
      logs.push(entity);
    }
    return entity;
  },
  async findOne({ where }: { where: { guildId: string; status: string } }) {
    const hits = logs.filter(l => l.guildId === where.guildId && l.status === where.status);
    return hits.sort((a, b) => b.completedAt - a.completedAt)[0] ?? null;
  },
};

let original: GetRepository;
beforeAll(() => {
  const ds = AppDataSource as unknown as { getRepository: GetRepository };
  original = ds.getRepository;
  ds.getRepository = (entity: any) => {
    if (entity?.name === 'ImportLog') return fakeLogRepo;
    throw new Error(`importManager test: no fake repo for ${entity?.name}`);
  };
});
afterAll(() => {
  (AppDataSource as unknown as { getRepository: GetRepository }).getRepository = original;
});

const rec = (userId: string, xp = 100): RawXpRecord => ({ userId, xp, level: 0, messageCount: 1 });

/** Importer whose result is supplied per guild; `gate` holds it until released. */
function fakeImporter(results: Record<string, Partial<ImportResult>>, gate?: Promise<void>): BotImporter {
  return {
    name: 'fake',
    displayName: 'Fake',
    supportedData: ['xp'],
    async import(guildId: string, _dataType: string, _options?: ImportOptions): Promise<ImportResult> {
      await gate;
      return { success: true, imported: 0, skipped: 0, failed: 0, errors: [], durationMs: 1, ...results[guildId] };
    },
  };
}

function makeManager(
  importer: BotImporter,
  write: typeof writeImportedXp = async (_g, records) => ({ written: records.length, skippedExisting: 0 }),
) {
  const writes: Array<{ guildId: string; userIds: string[]; options: { overwrite: boolean; dryRun: boolean } }> = [];
  const manager = new ImportManager(async (guildId, records, options) => {
    writes.push({ guildId, userIds: records.map(r => r.userId), options: { overwrite: options.overwrite, dryRun: options.dryRun } });
    return write(guildId, records, options);
  });
  manager.registerImporter(importer);
  return { manager, writes };
}

let seq = 0;
const nextGuild = () => `20000000000000${String(++seq).padStart(4, '0')}`;

describe('ImportManager.startImport', () => {
  test('writes the records and logs a completed import that starts the cooldown', async () => {
    const guild = nextGuild();
    const { manager, writes } = makeManager(
      fakeImporter({ [guild]: { imported: 3, records: [rec('1'), rec('2'), rec('3')] } }),
      async () => ({ written: 2, skippedExisting: 1 }),
    );

    const result = await manager.startImport(guild, 'fake', 'xp', 'admin', { overwrite: false });

    expect(writes).toEqual([{ guildId: guild, userIds: ['1', '2', '3'], options: { overwrite: false, dryRun: false } }]);
    expect(result).toMatchObject({ success: true, imported: 2, skipped: 1 });
    expect(result.records).toBeUndefined();
    const log = logs.find(l => l.guildId === guild);
    expect(log).toMatchObject({ status: 'completed', importedCount: 2, skippedCount: 1 });
    expect(await manager.checkCooldown(guild)).toBeInstanceOf(Date);
    expect(manager.isRunning(guild)).toBe(false);
  });

  test('a dry run is logged as dry_run and does not start the cooldown', async () => {
    const guild = nextGuild();
    const { manager, writes } = makeManager(fakeImporter({ [guild]: { records: [rec('1')] } }));

    const result = await manager.startImport(guild, 'fake', 'xp', 'admin', { dryRun: true, overwrite: true });

    expect(writes[0].options).toEqual({ overwrite: true, dryRun: true });
    expect(result.success).toBe(true);
    expect(logs.find(l => l.guildId === guild)?.status).toBe('dry_run');
    expect(await manager.checkCooldown(guild)).toBeNull();

    // Another dry run waits about 2 minutes, so MEE6 dry runs can't hammer its API
    const next = await manager.checkCooldown(guild, true);
    expect(next).toBeInstanceOf(Date);
    const wait = (next as Date).getTime() - Date.now();
    expect(wait).toBeGreaterThan(60_000);
    expect(wait).toBeLessThanOrEqual(120_000);
  });

  test('an import that writes no rows does not start the cooldown', async () => {
    const guild = nextGuild();
    const { manager } = makeManager(
      fakeImporter({ [guild]: { imported: 2, records: [rec('1'), rec('2')] } }),
      async () => ({ written: 0, skippedExisting: 2 }),
    );

    const result = await manager.startImport(guild, 'fake', 'xp', 'admin');

    expect(result).toMatchObject({ success: true, imported: 0, skipped: 2 });
    expect(logs.find(l => l.guildId === guild)?.status).toBe('no_changes');
    expect(await manager.checkCooldown(guild)).toBeNull();
  });

  test('a failed write fails the import loudly and does not start the cooldown', async () => {
    const guild = nextGuild();
    const { manager } = makeManager(fakeImporter({ [guild]: { imported: 1, records: [rec('1')] } }), async () => {
      throw new Error('Deadlock found');
    });

    const result = await manager.startImport(guild, 'fake', 'xp', 'admin');

    expect(result).toMatchObject({ success: false, imported: 0, errors: ['Deadlock found'] });
    expect(logs.find(l => l.guildId === guild)?.status).toBe('failed');
    expect(await manager.checkCooldown(guild)).toBeNull();
    expect(manager.isRunning(guild)).toBe(false);
  });

  test('an importer failure writes nothing', async () => {
    const guild = nextGuild();
    const { manager, writes } = makeManager(fakeImporter({ [guild]: { success: false, errors: ['not public'] } }));

    const result = await manager.startImport(guild, 'fake', 'xp', 'admin');

    expect(result.success).toBe(false);
    expect(writes).toHaveLength(0);
    expect(logs.find(l => l.guildId === guild)?.status).toBe('failed');
  });

  test('a second import in the same guild is refused while one runs', async () => {
    const guild = nextGuild();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const { manager, writes } = makeManager(fakeImporter({ [guild]: { records: [rec('1')] } }, gate));

    const first = manager.startImport(guild, 'fake', 'xp', 'admin');
    const second = await manager.startImport(guild, 'fake', 'xp', 'admin');
    release();
    await first;

    expect(second).toMatchObject({ success: false, errors: [lang.import.commands.importAlreadyRunning] });
    expect(writes).toHaveLength(1);
  });

  test('a cancelled import writes nothing and stays cancelled', async () => {
    const guild = nextGuild();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const { manager, writes } = makeManager(fakeImporter({ [guild]: { records: [rec('1')] } }, gate));

    const running = manager.startImport(guild, 'fake', 'xp', 'admin');
    expect(await manager.cancelImport(guild)).toBe(true);
    // The slot stays taken until the import has actually stopped
    expect(manager.isRunning(guild)).toBe(true);
    release();
    const result = await running;

    expect(writes).toHaveLength(0);
    expect(result).toMatchObject({ success: false, errors: [lang.import.commands.importCancelled] });
    expect(logs.find(l => l.guildId === guild)?.status).toBe('cancelled');
    expect(manager.isRunning(guild)).toBe(false);
  });

  test('a cancel during the write rolls it back and keeps the log cancelled', async () => {
    const guild = nextGuild();
    let firstChunk!: () => void;
    const firstChunkStarted = new Promise<void>(resolve => {
      firstChunk = resolve;
    });
    let releaseChunk!: () => void;
    const chunkGate = new Promise<void>(resolve => {
      releaseChunk = resolve;
    });
    const inserted: number[] = [];
    let committed = false;
    const store: XpImportStore = {
      existingUserIds: async () => new Set(),
      insertNew: async rows => {
        inserted.push(rows.length);
        firstChunk();
        await chunkGate;
      },
      upsert: async () => undefined,
    };
    const transaction: XpImportTransaction = async work => {
      const out = await work(store);
      committed = true;
      return out;
    };
    const records = Array.from({ length: XP_WRITE_CHUNK_SIZE + 1 }, (_, i) => rec(String(i)));
    const { manager } = makeManager(fakeImporter({ [guild]: { records } }), (g, r, o) =>
      writeImportedXp(g, r, o, transaction),
    );

    const running = manager.startImport(guild, 'fake', 'xp', 'admin');
    await firstChunkStarted;
    await manager.cancelImport(guild);
    releaseChunk();
    const result = await running;

    expect(inserted).toEqual([XP_WRITE_CHUNK_SIZE]);
    expect(committed).toBe(false);
    expect(result).toMatchObject({ success: false, imported: 0, errors: [lang.import.commands.importCancelled] });
    expect(logs.find(l => l.guildId === guild)?.status).toBe('cancelled');
    expect(await manager.checkCooldown(guild)).toBeNull();
    expect(manager.isRunning(guild)).toBe(false);
  });

  test('concurrent imports in two guilds each write only their own records', async () => {
    const guildA = nextGuild();
    const guildB = nextGuild();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const { manager, writes } = makeManager(
      fakeImporter({ [guildA]: { records: [rec('a1')] }, [guildB]: { records: [rec('b1'), rec('b2')] } }, gate),
    );

    const runs = [
      manager.startImport(guildA, 'fake', 'xp', 'admin'),
      manager.startImport(guildB, 'fake', 'xp', 'admin'),
    ];
    release();
    await Promise.all(runs);

    expect(writes.find(w => w.guildId === guildA)?.userIds).toEqual(['a1']);
    expect(writes.find(w => w.guildId === guildB)?.userIds).toEqual(['b1', 'b2']);
  });
});
