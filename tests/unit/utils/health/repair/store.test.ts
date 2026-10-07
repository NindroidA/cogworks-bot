/**
 * RepairStore against fake repositories. The fake transaction snapshots every
 * table and restores it on a throw, like a database rollback, and logs each
 * write with whether it ran inside the transaction.
 */
import { describe, expect, test } from 'bun:test';
import { FindOperator } from 'typeorm';
import { REF_PATCHES, type RefEntityName, type RemovePatch } from '../../../../../src/utils/cleanup/refPatches';
import { applyRepairPlan } from '../../../../../src/utils/health/repair/applier';
import { planRepairs } from '../../../../../src/utils/health/repair/planner';
import { createRepairStore, type RepairDb } from '../../../../../src/utils/health/repair/store';
import type { HealthFinding, HealthReport } from '../../../../../src/utils/health/types';
import { makeFakeGuild } from '../../../../helpers/fakeGuild';
import { type FakeRepo, makeFakeRepo } from '../../../../helpers/fakeRepo';
import { makeCheckContext } from '../../../../helpers/healthContext';

const G = '100000000000000001';
const OTHER = '100000000000000002';
const CH = '300000000000000001';
const GONE = '300000000000000666';
const GONE_2 = '300000000000000667';
const GONE_ROLE = '200000000000000666';
const LOCK = { mode: 'pessimistic_write' };

function makeDb(tables: Partial<Record<RefEntityName, any[]>>) {
  const repos = new Map<RefEntityName, FakeRepo>();
  const log: string[] = [];
  let depth = 0;
  let transactions = 0;
  const repo = (entity: RefEntityName) => {
    let fake = repos.get(entity);
    if (!fake) {
      fake = makeFakeRepo();
      repos.set(entity, fake);
      for (const method of ['update', 'delete', 'insert'] as const) {
        const inner = fake[method] as (...args: any[]) => Promise<any>;
        (fake as any)[method] = (...args: any[]) => {
          log.push(`${depth > 0 ? 'tx ' : ''}${method} ${entity}`);
          return inner(...args);
        };
      }
    }
    return fake;
  };
  for (const [entity, rows] of Object.entries(tables)) {
    const fake = repo(entity as RefEntityName);
    for (const row of rows ?? []) fake.rows.set(String(row.id ?? row.guildId), row);
  }
  const db: RepairDb = {
    repo,
    async transaction(work) {
      transactions++;
      const snapshot = [...repos.values()].map(fake => [fake, structuredClone(fake.rows)] as const);
      depth++;
      try {
        return await work({ repo });
      } catch (error) {
        for (const [fake, rows] of snapshot) fake.rows = rows;
        throw error;
      } finally {
        depth--;
      }
    },
  };
  const ids = (entity: RefEntityName) => [...repo(entity).rows.values()].map(row => row.id);
  return { db, store: createRepairStore(db), repo, log, ids, transactions: () => transactions };
}

const cascadeOf = (patch: unknown) => (patch as RemovePatch).cascade;

describe('RepairStore: guild scope', () => {
  test('a write without a guildId throws before touching a repository', async () => {
    const { store, log, transactions } = makeDb({ XPConfig: [{ id: 5, guildId: G, levelUpChannelId: GONE }] });
    const set = { levelUpChannelId: null };
    await expect(store.set('XPConfig', { id: 5 }, { levelUpChannelId: GONE }, set)).rejects.toThrow('guildId');
    await expect(store.set('XPConfig', { guildId: '', id: 5 }, {}, set)).rejects.toThrow('guildId');
    await expect(store.delete('XPConfig', { id: 5 }, {})).rejects.toThrow('guildId');
    await expect(store.insert('XPConfig', { id: 6 })).rejects.toThrow('guildId');
    expect(log).toEqual([]);
    expect(transactions()).toBe(0);
  });

  test('an empty guard or set is refused before any write', async () => {
    const { store, log, transactions } = makeDb({ XPConfig: [{ id: 5, guildId: G, levelUpChannelId: GONE }] });
    const where = { guildId: G, id: 5 };
    const guard = { levelUpChannelId: GONE };
    await expect(store.set('XPConfig', where, {}, { levelUpChannelId: null })).rejects.toThrow('non-empty guard');
    await expect(store.set('XPConfig', where, guard, {})).rejects.toThrow('non-empty set');
    await expect(store.delete('XPConfig', where, {})).rejects.toThrow('non-empty guard');
    expect(log).toEqual([]);
    expect(transactions()).toBe(0);
  });

  test('an owned child (options) only cascades from its own parent (a menu)', async () => {
    const { store, log, ids, transactions } = makeDb({
      MemoryConfig: [{ id: 4, guildId: G, forumChannelId: GONE }],
      ReactionRoleOption: [{ id: 40, menuId: 4 }],
    });
    const cascade = [{ entity: 'ReactionRoleOption', column: 'menuId' }] as const;
    await expect(
      store.delete('MemoryConfig', { guildId: G, id: 4 }, { forumChannelId: GONE }, cascade),
    ).rejects.toThrow("can't cascade from MemoryConfig");
    expect(log).toEqual([]);
    expect(transactions()).toBe(0);
    expect(ids('ReactionRoleOption')).toEqual([40]);
  });

  test("another guild's row with the same id is gone, and untouched", async () => {
    const row = { id: 5, guildId: OTHER, levelUpChannelId: GONE };
    const { store } = makeDb({ XPConfig: [row] });
    const where = { guildId: G, id: 5 };
    expect(await store.set('XPConfig', where, { levelUpChannelId: GONE }, { levelUpChannelId: null })).toBe('gone');
    expect(row.levelUpChannelId).toBe(GONE);
  });
});

describe('RepairStore: scalar guards', () => {
  test('one conditional update on guard plus where, no transaction', async () => {
    const { store, repo, transactions } = makeDb({
      BotConfig: [{ guildId: G, globalStaffRole: GONE_ROLE, enableGlobalStaffRole: true }],
    });
    const guard = { globalStaffRole: GONE_ROLE, enableGlobalStaffRole: true };
    const set = { globalStaffRole: null, enableGlobalStaffRole: false };
    expect(await store.set('BotConfig', { guildId: G }, guard, set)).toBe('applied');
    expect(repo('BotConfig').calls.update).toEqual([{ criteria: { ...guard, guildId: G }, partial: set }]);
    expect(repo('BotConfig').rows.get(G)).toEqual({ guildId: G, ...set });
    expect(repo('BotConfig').calls.count).toEqual([]);
    expect(transactions()).toBe(0);
  });

  test('a null guard value is written as IsNull()', async () => {
    const ticket = { id: 7, guildId: G, channelId: GONE, status: 'opened', statusHistory: null };
    const { store, repo } = makeDb({ Ticket: [ticket] });
    const set = { status: 'closed', statusHistory: [{ status: 'closed', note: 'channel-deleted' }] };
    const where = { guildId: G, id: 7 };
    expect(await store.set('Ticket', where, { status: 'opened', statusHistory: null }, set)).toBe('applied');
    const { criteria } = repo('Ticket').calls.update[0];
    expect(criteria.statusHistory).toBeInstanceOf(FindOperator);
    expect(criteria.statusHistory.type).toBe('isNull');
    expect(criteria).toMatchObject({ status: 'opened', guildId: G, id: 7 });
    expect(ticket.status).toBe('closed');
  });

  test('affected 0 reads the row: stale when it changed, gone when it is deleted', async () => {
    const { store, repo } = makeDb({ StarboardConfig: [{ id: 2, guildId: G, enabled: true, channelId: CH }] });
    const guard = { enabled: true, channelId: GONE };
    const set = { enabled: false, channelId: '' };
    expect(await store.set('StarboardConfig', { guildId: G, id: 2 }, guard, set)).toBe('stale');
    expect(repo('StarboardConfig').calls.count).toEqual([{ where: { guildId: G, id: 2 } }]);
    expect(await store.set('StarboardConfig', { guildId: G, id: 3 }, guard, set)).toBe('gone');
    expect(repo('StarboardConfig').rows.get('2')).toMatchObject({ enabled: true, channelId: CH });
  });

  test('a conditional delete: applied, then stale once the reference changed', async () => {
    const { store, repo, ids } = makeDb({
      StaffRole: [
        { id: 3, guildId: G, role: GONE_ROLE },
        { id: 4, guildId: G, role: 'other' },
      ],
    });
    expect(await store.delete('StaffRole', { guildId: G, id: 3 }, { role: GONE_ROLE })).toBe('applied');
    expect(repo('StaffRole').calls.delete).toEqual([{ role: GONE_ROLE, guildId: G, id: 3 }]);
    expect(await store.delete('StaffRole', { guildId: G, id: 4 }, { role: GONE_ROLE })).toBe('stale');
    expect(await store.delete('StaffRole', { guildId: G, id: 3 }, { role: GONE_ROLE })).toBe('gone');
    expect(ids('StaffRole')).toEqual([4]);
  });
});

describe('RepairStore: JSON guards', () => {
  const xp = (ignoredChannels: string[]) => ({ id: 5, guildId: G, ignoredChannels });
  const guard = { ignoredChannels: [CH, GONE, GONE_2] };
  const set = { ignoredChannels: [CH] };

  test('lock the row, compare deeply, then update by where alone', async () => {
    const { store, repo, log, transactions } = makeDb({ XPConfig: [xp([CH, GONE, GONE_2])] });
    expect(await store.set('XPConfig', { guildId: G, id: 5 }, guard, set)).toBe('applied');
    expect(repo('XPConfig').calls.findOne).toEqual([
      { where: { guildId: G, id: 5 }, lock: LOCK, loadEagerRelations: false },
    ]);
    expect(repo('XPConfig').calls.update).toEqual([{ criteria: { guildId: G, id: 5 }, partial: set }]);
    expect(log).toEqual(['tx update XPConfig']);
    expect(transactions()).toBe(1);
    expect(repo('XPConfig').rows.get('5').ignoredChannels).toEqual([CH]);
  });

  test('a list that changed since the check is stale; a deleted row is gone', async () => {
    const { store, repo } = makeDb({ XPConfig: [xp([CH, GONE, GONE_2, '300000000000000009'])] });
    expect(await store.set('XPConfig', { guildId: G, id: 5 }, guard, set)).toBe('stale');
    expect(await store.set('XPConfig', { guildId: G, id: 6 }, guard, set)).toBe('gone');
    expect(repo('XPConfig').calls.update).toEqual([]);
  });
});

describe('RepairStore: cascades', () => {
  const memoryCascade = cascadeOf(REF_PATCHES.channel.MemoryConfig({ forumChannelId: GONE }, GONE));
  const memoryTables = (forumChannelId = GONE) => ({
    MemoryConfig: [{ id: 3, guildId: G, forumChannelId }],
    MemoryItem: [
      { id: 10, guildId: G, memoryConfigId: 3 },
      { id: 11, guildId: G, memoryConfigId: 3 },
      { id: 12, guildId: G, memoryConfigId: 4 },
      { id: 13, guildId: OTHER, memoryConfigId: 3 },
    ],
    MemoryTag: [{ id: 20, guildId: G, memoryConfigId: 3 }],
  });

  test("children go first, scoped to the guild, in the parent's transaction", async () => {
    const { store, repo, log, ids } = makeDb(memoryTables());
    const outcome = await store.delete('MemoryConfig', { guildId: G, id: 3 }, { forumChannelId: GONE }, memoryCascade);
    expect(outcome).toBe('applied');
    expect(log).toEqual(['tx delete MemoryItem', 'tx delete MemoryTag', 'tx delete MemoryConfig']);
    expect(repo('MemoryItem').calls.delete).toEqual([{ guildId: G, memoryConfigId: 3 }]);
    expect(ids('MemoryItem')).toEqual([12, 13]);
    expect(ids('MemoryTag')).toEqual([]);
    expect(ids('MemoryConfig')).toEqual([]);
  });

  test('a parent that changed is stale and deletes nothing', async () => {
    const { store, log, ids } = makeDb(memoryTables(CH));
    const outcome = await store.delete('MemoryConfig', { guildId: G, id: 3 }, { forumChannelId: GONE }, memoryCascade);
    expect(outcome).toBe('stale');
    expect(log).toEqual([]);
    expect(ids('MemoryItem')).toEqual([10, 11, 12, 13]);
  });

  test('a parent delete that affects nothing rolls the children back', async () => {
    const { store, repo, log, ids } = makeDb(memoryTables());
    repo('MemoryConfig').delete = async () => ({ affected: 0 });
    const outcome = await store.delete('MemoryConfig', { guildId: G, id: 3 }, { forumChannelId: GONE }, memoryCascade);
    expect(outcome).toBe('stale');
    expect(log).toEqual(['tx delete MemoryItem', 'tx delete MemoryTag']);
    expect(ids('MemoryItem')).toEqual([10, 11, 12, 13]);
    expect(ids('MemoryTag')).toEqual([20]);
    expect(ids('MemoryConfig')).toEqual([3]);
  });

  test('a menu takes its options by menuId (they have no guildId), and only its own', async () => {
    const menuCascade = cascadeOf(REF_PATCHES.channel.ReactionRoleMenu({ channelId: GONE }, GONE));
    const { store, repo, log, ids } = makeDb({
      ReactionRoleMenu: [{ id: 4, guildId: G, channelId: GONE }],
      ReactionRoleOption: [
        { id: 40, menuId: 4 },
        { id: 41, menuId: 4 },
        { id: 50, menuId: 5 },
      ],
    });
    const outcome = await store.delete('ReactionRoleMenu', { guildId: G, id: 4 }, { channelId: GONE }, menuCascade);
    expect(outcome).toBe('applied');
    expect(log).toEqual(['tx delete ReactionRoleOption', 'tx delete ReactionRoleMenu']);
    expect(repo('ReactionRoleOption').calls.delete).toEqual([{ menuId: 4 }]);
    expect(ids('ReactionRoleOption')).toEqual([50]);
  });
});

describe('RepairStore: reaction-role option ownership', () => {
  const tables = () => ({
    ReactionRoleMenu: [
      { id: 4, guildId: G },
      { id: 5, guildId: OTHER },
    ],
    ReactionRoleOption: [
      { id: 40, menuId: 4, roleId: GONE_ROLE },
      { id: 41, menuId: 4, roleId: 'kept' },
      { id: 50, menuId: 5, roleId: GONE_ROLE },
    ],
  });

  test('locks the guild-scoped menu, then deletes the option by id and menuId', async () => {
    const { store, repo, ids } = makeDb(tables());
    const where = { guildId: G, id: 40, menuId: 4 };
    expect(await store.delete('ReactionRoleOption', where, { roleId: GONE_ROLE })).toBe('applied');
    expect(repo('ReactionRoleMenu').calls.findOne).toEqual([
      { where: { id: 4, guildId: G }, lock: LOCK, loadEagerRelations: false },
    ]);
    expect(repo('ReactionRoleOption').calls.delete).toEqual([{ id: 40, menuId: 4 }]);
    expect(ids('ReactionRoleOption')).toEqual([41, 50]);
  });

  test("refuses another guild's option, and a changed option is stale", async () => {
    const { store, repo, log, ids } = makeDb(tables());
    const theirs = { guildId: G, id: 50, menuId: 5 };
    expect(await store.delete('ReactionRoleOption', theirs, { roleId: GONE_ROLE })).toBe('gone');
    expect(repo('ReactionRoleOption').calls.findOne).toEqual([]);
    const changed = { guildId: G, id: 41, menuId: 4 };
    expect(await store.delete('ReactionRoleOption', changed, { roleId: GONE_ROLE })).toBe('stale');
    expect(log).toEqual([]);
    expect(ids('ReactionRoleOption')).toEqual([40, 41, 50]);
  });

  test('an option where without menuId throws', async () => {
    const { store } = makeDb(tables());
    await expect(store.delete('ReactionRoleOption', { guildId: G, id: 40 }, { roleId: GONE_ROLE })).rejects.toThrow(
      'menuId',
    );
  });
});

describe('RepairStore: insert', () => {
  test('applied, exists on a duplicate key, other errors thrown', async () => {
    const { store, repo } = makeDb({});
    const values = { guildId: G, name: 'welcome' };
    expect(await store.insert('AnnouncementConfig', values)).toBe('applied');
    expect(repo('AnnouncementConfig').calls.insert).toEqual([values]);
    repo('AnnouncementConfig').insert = async () => {
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    };
    expect(await store.insert('AnnouncementConfig', values)).toBe('exists');
    repo('AnnouncementConfig').insert = async () => {
      throw new Error('connection lost');
    };
    await expect(store.insert('AnnouncementConfig', values)).rejects.toThrow('connection lost');
  });
});

describe('planner steps through the applier into the store', () => {
  test('an option, a memory forum with its items and an XP list land as planned', async () => {
    const ROLE = '200000000000000001';
    const options = [
      { id: 40, menuId: 4, roleId: GONE_ROLE, emoji: '👍', sortOrder: 0 },
      { id: 41, menuId: 4, roleId: ROLE, emoji: '🎉', sortOrder: 1 },
    ];
    const menu = { id: 4, guildId: G, name: 'Roles', channelId: CH, messageId: '500000000000000001', mode: 'normal' };
    const memoryConfig = { id: 3, guildId: G, forumChannelId: GONE, messageId: null };
    const items = [{ id: 10, guildId: G, memoryConfigId: 3, threadId: '400000000000000001' }];
    const xp = { id: 5, guildId: G, ignoredChannels: [CH, GONE, GONE_2] };
    const finding = (code: string, entity: string, rowId: number, field: string, refId: string): HealthFinding => ({
      code,
      system: code.split('.')[0] as HealthFinding['system'],
      severity: 'degraded',
      repair: 'auto',
      entity,
      rowId,
      field,
      refId,
      params: {},
    });
    const findings = [
      finding('reactionRole.option.role_missing', 'ReactionRoleOption', 40, 'roleId', GONE_ROLE),
      finding('memory.forum.missing', 'MemoryConfig', 3, 'forumChannelId', GONE),
      finding('xp.config.ignored_channel_missing', 'XPConfig', 5, 'ignoredChannels', GONE),
      finding('xp.config.ignored_channel_missing', 'XPConfig', 5, 'ignoredChannels', GONE_2),
    ];
    const report: HealthReport = {
      guildId: G,
      botVersion: 'test',
      checkedAt: '2026-10-06T12:00:00.000Z',
      deep: false,
      systems: { core: { status: 'warn', findings } },
      counts: { auto: 4, confirm: 0, manual: 0 },
      notChecked: [],
    };
    const guild = makeFakeGuild({ id: G, roles: [{ id: ROLE }], channels: [{ id: CH }] });
    const ctx = makeCheckContext({
      guild,
      rows: {
        ReactionRoleMenu: [{ ...menu, options: structuredClone(options) }],
        MemoryConfig: [{ ...memoryConfig }],
        MemoryItem: structuredClone(items),
        MemoryTag: [],
        XPConfig: [structuredClone(xp)],
      },
    });
    const plan = planRepairs(report, ctx);
    expect(plan.unsupported).toEqual([]);

    const { db, ids, repo } = makeDb({
      ReactionRoleMenu: [menu],
      ReactionRoleOption: options,
      MemoryConfig: [memoryConfig],
      MemoryItem: items,
      XPConfig: [xp],
    });
    const noop = () => {};
    const result = await applyRepairPlan(
      guild,
      plan,
      { userId: '900000000000000001', source: 'command', checkedAt: report.checkedAt },
      {
        store: createRepairStore(db),
        invalidateGuildCaches: noop,
        invalidateBaitCaches: noop,
        requestGuildCommandRefresh: noop,
        writeAuditLog: async () => {},
      },
    );
    expect(result.results.map(r => [r.step.entity, r.outcome])).toEqual([
      ['XPConfig', 'applied'],
      ['ReactionRoleOption', 'applied'],
      ['MemoryConfig', 'applied'],
    ]);
    expect(ids('ReactionRoleOption')).toEqual([41]);
    expect(ids('MemoryConfig')).toEqual([]);
    expect(ids('MemoryItem')).toEqual([]);
    expect(repo('XPConfig').rows.get('5').ignoredChannels).toEqual([CH]);
  });
});
