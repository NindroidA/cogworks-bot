/**
 * guildQueries Unit Tests
 *
 * Confirms the v3.1.5 error-propagation contract: helpers return the happy-
 * path / not-found values unchanged, but DB errors propagate to the caller
 * instead of being swallowed. Uses a hand-rolled repository fake rather than
 * jest.mock (Bun test runner does not support jest.mock).
 */

import { describe, expect, test } from 'bun:test';
import type { Repository } from 'typeorm';
import {
  countByGuild,
  deleteByGuild,
  findManyByGuild,
  findOneByGuild,
  upsertGuildEntity,
} from '../../../../src/utils/database/guildQueries';

interface FakeEntity {
  guildId: string;
  id: number;
  name?: string;
}

type FakeRepo = {
  findOne: (opts: unknown) => Promise<FakeEntity | null>;
  find: (opts: unknown) => Promise<FakeEntity[]>;
  count: (opts: unknown) => Promise<number>;
  delete: (where: unknown) => Promise<{ affected?: number }>;
  create: (data: unknown) => FakeEntity;
  save: (entity: FakeEntity) => Promise<FakeEntity>;
  metadata: { name: string };
};

function makeFakeRepo(overrides: Partial<FakeRepo> = {}): Repository<FakeEntity> {
  const base: FakeRepo = {
    findOne: async () => null,
    find: async () => [],
    count: async () => 0,
    delete: async () => ({ affected: 0 }),
    create: (data: unknown) => ({ ...(data as FakeEntity) }),
    save: async (entity: FakeEntity) => entity,
    metadata: { name: 'FakeEntity' },
    ...overrides,
  };
  return base as unknown as Repository<FakeEntity>;
}

const GUILD = '123456789012345678';
const DB_ERROR = new Error('ER_CON_COUNT_ERROR: Too many connections');

describe('guildQueries — error propagation contract (v3.1.5+)', () => {
  describe('findOneByGuild()', () => {
    test('returns the row on happy path', async () => {
      const row: FakeEntity = { guildId: GUILD, id: 7 };
      const repo = makeFakeRepo({ findOne: async () => row });
      const result = await findOneByGuild(repo, GUILD);
      expect(result).toBe(row);
    });

    test('returns null when no row matches (not-found)', async () => {
      const repo = makeFakeRepo({ findOne: async () => null });
      const result = await findOneByGuild(repo, GUILD);
      expect(result).toBeNull();
    });

    test('propagates DB errors instead of swallowing them', async () => {
      const repo = makeFakeRepo({
        findOne: async () => {
          throw DB_ERROR;
        },
      });
      await expect(findOneByGuild(repo, GUILD)).rejects.toThrow(DB_ERROR.message);
    });

    test('passes guildId into the where clause', async () => {
      let captured: unknown = null;
      const repo = makeFakeRepo({
        findOne: async opts => {
          captured = opts;
          return null;
        },
      });
      await findOneByGuild(repo, GUILD);
      expect((captured as { where: { guildId: string } }).where.guildId).toBe(GUILD);
    });
  });

  describe('findManyByGuild()', () => {
    test('returns an array on happy path', async () => {
      const rows: FakeEntity[] = [
        { guildId: GUILD, id: 1 },
        { guildId: GUILD, id: 2 },
      ];
      const repo = makeFakeRepo({ find: async () => rows });
      const result = await findManyByGuild(repo, GUILD);
      expect(result).toEqual(rows);
    });

    test('returns empty array when nothing matches', async () => {
      const repo = makeFakeRepo({ find: async () => [] });
      expect(await findManyByGuild(repo, GUILD)).toEqual([]);
    });

    test('propagates DB errors', async () => {
      const repo = makeFakeRepo({
        find: async () => {
          throw DB_ERROR;
        },
      });
      await expect(findManyByGuild(repo, GUILD)).rejects.toThrow(DB_ERROR.message);
    });

    test('merges caller where clause with guildId', async () => {
      let captured: unknown = null;
      const repo = makeFakeRepo({
        find: async opts => {
          captured = opts;
          return [];
        },
      });
      await findManyByGuild(repo, GUILD, { where: { id: 42 } as Partial<FakeEntity> });
      const where = (captured as { where: Record<string, unknown> }).where;
      expect(where.guildId).toBe(GUILD);
      expect(where.id).toBe(42);
    });
  });

  describe('countByGuild()', () => {
    test('returns the count on happy path', async () => {
      const repo = makeFakeRepo({ count: async () => 17 });
      expect(await countByGuild(repo, GUILD)).toBe(17);
    });

    test('returns 0 when nothing matches', async () => {
      const repo = makeFakeRepo({ count: async () => 0 });
      expect(await countByGuild(repo, GUILD)).toBe(0);
    });

    test('propagates DB errors', async () => {
      const repo = makeFakeRepo({
        count: async () => {
          throw DB_ERROR;
        },
      });
      await expect(countByGuild(repo, GUILD)).rejects.toThrow(DB_ERROR.message);
    });
  });

  describe('deleteByGuild()', () => {
    test('returns { affected } on happy path', async () => {
      const repo = makeFakeRepo({ delete: async () => ({ affected: 5 }) });
      expect(await deleteByGuild(repo, GUILD)).toEqual({ affected: 5 });
    });

    test('normalises missing affected to 0', async () => {
      const repo = makeFakeRepo({ delete: async () => ({}) });
      expect(await deleteByGuild(repo, GUILD)).toEqual({ affected: 0 });
    });

    test('propagates DB errors', async () => {
      const repo = makeFakeRepo({
        delete: async () => {
          throw DB_ERROR;
        },
      });
      await expect(deleteByGuild(repo, GUILD)).rejects.toThrow(DB_ERROR.message);
    });

    test('merges additionalWhere with guildId', async () => {
      let captured: unknown = null;
      const repo = makeFakeRepo({
        delete: async where => {
          captured = where;
          return { affected: 0 };
        },
      });
      await deleteByGuild(repo, GUILD, { id: 9 } as Partial<FakeEntity>);
      expect(captured).toMatchObject({ guildId: GUILD, id: 9 });
    });
  });

  describe('upsertGuildEntity()', () => {
    test('updates the existing row (no create) and saves', async () => {
      const existing: FakeEntity = { guildId: GUILD, id: 7, name: 'old' };
      let createdCalled = false;
      let saved: FakeEntity | undefined;
      const repo = makeFakeRepo({
        findOne: async () => existing,
        create: () => {
          createdCalled = true;
          return { guildId: GUILD, id: 0 };
        },
        save: async e => {
          saved = e;
          return e;
        },
      });
      const result = await upsertGuildEntity(repo, GUILD, { apply: e => (e.name = 'new') });
      expect(createdCalled).toBe(false);
      expect(result.name).toBe('new');
      expect(saved).toBe(existing);
    });

    test('creates with guildId + seed when no row exists, then applies + saves', async () => {
      let createArg: unknown;
      const repo = makeFakeRepo({
        findOne: async () => null,
        create: (data: unknown) => {
          createArg = data;
          return { ...(data as FakeEntity) };
        },
      });
      const result = await upsertGuildEntity(repo, GUILD, {
        create: { id: 42 },
        apply: e => (e.name = 'seeded'),
      });
      expect(createArg).toMatchObject({ guildId: GUILD, id: 42 });
      expect(result).toMatchObject({ guildId: GUILD, id: 42, name: 'seeded' });
    });

    test('merges extra where keys with guildId for the lookup', async () => {
      let whereCaptured: Record<string, unknown> | undefined;
      const repo = makeFakeRepo({
        findOne: async (opts: unknown) => {
          whereCaptured = (opts as { where: Record<string, unknown> }).where;
          return { guildId: GUILD, id: 5 };
        },
      });
      await upsertGuildEntity(repo, GUILD, { where: { id: 5 } as Partial<FakeEntity> });
      expect(whereCaptured).toMatchObject({ guildId: GUILD, id: 5 });
    });

    test('propagates DB errors from save', async () => {
      const repo = makeFakeRepo({
        findOne: async () => ({ guildId: GUILD, id: 1 }),
        save: async () => {
          throw DB_ERROR;
        },
      });
      await expect(upsertGuildEntity(repo, GUILD)).rejects.toThrow(DB_ERROR.message);
    });
  });
});
