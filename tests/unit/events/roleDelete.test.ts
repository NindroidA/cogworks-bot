/**
 * roleDelete Event Handler Unit Tests
 *
 * Verifies the v3.1.32 descriptor pattern for role deletion:
 *  - All 9 entity-cleanup descriptors run for a single role-delete event
 *  - Promise.allSettled isolation — one cleaner failing doesn't abort siblings
 *  - Per-entity mutation: nullify scalar columns, filter array columns, remove
 *    rows that exist solely to reference the role
 *  - ReactionRoleOption uses a QueryBuilder join (not findOneBy) — fake handles
 *    that path with a tiny chainable stub that defers to the same row store.
 *  - Cache invalidations fire when expected (rules + reactionRole guild menu)
 *  - Bait channel manager cache flush is invoked on whitelist mutation
 */
import { afterAll, beforeAll, beforeEach, describe, expect, jest, mock, test } from 'bun:test';

interface FakeRepoState {
  rows: Map<string, any>;
  findOneByCalls: any[];
  findCalls: any[];
  saveCalls: any[];
  removeCalls: any[];
  qbCalls: any[];
  shouldThrowOn?: 'findOneBy' | 'find' | 'save' | 'remove' | 'getMany';
}

function makeFakeRepo(initialRows: any[] = []): FakeRepoState & {
  findOneBy: (where: any) => Promise<any>;
  find: (opts: any) => Promise<any[]>;
  save: (entity: any) => Promise<any>;
  remove: (entity: any) => Promise<any>;
  createQueryBuilder: (alias: string) => any;
} {
  const state: FakeRepoState = {
    rows: new Map(initialRows.map((r, i) => [String(r.id ?? i), r])),
    findOneByCalls: [],
    findCalls: [],
    saveCalls: [],
    removeCalls: [],
    qbCalls: [],
  };
  return {
    ...state,
    async findOneBy(where: any) {
      state.findOneByCalls.push(where);
      if (state.shouldThrowOn === 'findOneBy') throw new Error('boom');
      for (const row of state.rows.values()) {
        if (Object.entries(where).every(([k, v]) => (row as any)[k] === v)) return row;
      }
      return null;
    },
    async find(opts: any) {
      state.findCalls.push(opts);
      if (state.shouldThrowOn === 'find') throw new Error('boom');
      const where = opts?.where ?? {};
      return [...state.rows.values()].filter(row => Object.entries(where).every(([k, v]) => (row as any)[k] === v));
    },
    async save(entity: any) {
      state.saveCalls.push({ ...entity });
      if (state.shouldThrowOn === 'save') throw new Error('boom');
      state.rows.set(String(entity.id ?? state.rows.size), entity);
      return entity;
    },
    async remove(entity: any) {
      state.removeCalls.push(Array.isArray(entity) ? [...entity] : { ...entity });
      if (state.shouldThrowOn === 'remove') throw new Error('boom');
      const targets = Array.isArray(entity) ? entity : [entity];
      for (const t of targets) state.rows.delete(String(t.id));
      return entity;
    },
    createQueryBuilder(alias: string) {
      const params: Record<string, any> = {};
      const builder: any = {
        innerJoin: (_assoc: string, _alias: string) => builder,
        where: (_clause: string, p?: Record<string, any>) => {
          Object.assign(params, p ?? {});
          return builder;
        },
        andWhere: (_clause: string, p?: Record<string, any>) => {
          Object.assign(params, p ?? {});
          return builder;
        },
        async getMany() {
          state.qbCalls.push({ alias, params: { ...params } });
          if (state.shouldThrowOn === 'getMany') throw new Error('boom');
          return [...state.rows.values()].filter(row =>
            Object.entries(params).every(([k, v]) => (row as any)[k] === v),
          );
        },
      };
      return builder;
    },
  } as any;
}

const fakeRepos: Record<string, ReturnType<typeof makeFakeRepo>> = {};

function resetFakeRepos() {
  for (const key of Object.keys(fakeRepos)) delete fakeRepos[key];
  for (const name of [
    'BotConfig',
    'RulesConfig',
    'ReactionRoleOption',
    'AnnouncementConfig',
    'StaffRole',
    'XPConfig',
    'XPRoleReward',
    'OnboardingConfig',
    'BaitChannelConfig',
  ]) {
    fakeRepos[name] = makeFakeRepo();
  }
}

const fakeInvalidateRulesCache = jest.fn();
const fakeInvalidateGuildMenuCache = jest.fn();

mock.module('../../../src/utils/rules/rulesCache', () => ({
  invalidateRulesCache: fakeInvalidateRulesCache,
}));
mock.module('../../../src/utils/reactionRole/menuCache', () => ({
  invalidateGuildMenuCache: fakeInvalidateGuildMenuCache,
  invalidateMenuCache: jest.fn(),
  getCachedMenu: jest.fn(),
  getOptionByEmoji: jest.fn(),
}));

let roleDeleteHandler: typeof import('../../../src/events/roleDelete').default;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../src/typeorm');
  // Capture the original so afterAll can put it back. Bun runs test files in
  // a single process; leaving the patch installed leaks into every file that
  // runs after this one.
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    const name = entity?.name ?? 'unknown';
    if (!fakeRepos[name]) {
      throw new Error(`roleDelete test: no fake repo registered for entity "${name}"`);
    }
    return fakeRepos[name];
  };
  roleDeleteHandler = (await import('../../../src/events/roleDelete')).default;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

function makeRole(opts: { guildId: string; roleId: string; name?: string }): any {
  return {
    id: opts.roleId,
    name: opts.name ?? 'deleted-role',
    guild: { id: opts.guildId },
  };
}

const mockClient: any = {
  baitChannelManager: { clearConfigCache: jest.fn() },
};

describe('roleDelete event handler', () => {
  beforeEach(() => {
    resetFakeRepos();
    fakeInvalidateRulesCache.mockClear();
    fakeInvalidateGuildMenuCache.mockClear();
    mockClient.baitChannelManager.clearConfigCache.mockClear();
  });

  test('descriptor sweep: every entity is queried for any role delete', async () => {
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);

    const queriedEntities = Object.entries(fakeRepos)
      .filter(([_, repo]) => repo.findOneByCalls.length > 0 || repo.findCalls.length > 0 || repo.qbCalls.length > 0)
      .map(([name]) => name)
      .sort();
    // 9 entities — the regression list. Removing a descriptor would fail this.
    expect(queriedEntities).toEqual(
      [
        'AnnouncementConfig',
        'BaitChannelConfig',
        'BotConfig',
        'OnboardingConfig',
        'ReactionRoleOption',
        'RulesConfig',
        'StaffRole',
        'XPConfig',
        'XPRoleReward',
      ].sort(),
    );
  });

  test('BotConfig: nullifies globalStaffRole + disables flag when matching', async () => {
    fakeRepos.BotConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      globalStaffRole: 'r-1',
      enableGlobalStaffRole: true,
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.BotConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.BotConfig.saveCalls[0].globalStaffRole).toBeNull();
    expect(fakeRepos.BotConfig.saveCalls[0].enableGlobalStaffRole).toBe(false);
  });

  test('BotConfig: skips save when globalStaffRole does not match', async () => {
    fakeRepos.BotConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      globalStaffRole: 'other-role',
      enableGlobalStaffRole: true,
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.BotConfig.saveCalls.length).toBe(0);
  });

  test('RulesConfig: removes matching record and invalidates rules cache', async () => {
    fakeRepos.RulesConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      roleId: 'r-1',
      channelId: 'c-1',
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.RulesConfig.removeCalls.length).toBe(1);
    expect(fakeInvalidateRulesCache).toHaveBeenCalledWith('g-1');
  });

  test('ReactionRoleOption: removes matching options and invalidates guild menu cache', async () => {
    fakeRepos.ReactionRoleOption.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      roleId: 'r-1',
    });
    fakeRepos.ReactionRoleOption.rows.set('2', {
      id: 2,
      guildId: 'g-1',
      roleId: 'r-1',
    });
    fakeRepos.ReactionRoleOption.rows.set('3', {
      id: 3,
      guildId: 'g-1',
      roleId: 'other',
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.ReactionRoleOption.removeCalls.length).toBe(1);
    // Should remove only the 2 matching rows
    expect(fakeRepos.ReactionRoleOption.removeCalls[0].length).toBe(2);
    expect(fakeInvalidateGuildMenuCache).toHaveBeenCalledWith('g-1');
  });

  test('ReactionRoleOption: no-op when no options reference the role', async () => {
    fakeRepos.ReactionRoleOption.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      roleId: 'other',
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.ReactionRoleOption.removeCalls.length).toBe(0);
    expect(fakeInvalidateGuildMenuCache).not.toHaveBeenCalled();
  });

  test('AnnouncementConfig: nullifies defaultRoleId when matching', async () => {
    fakeRepos.AnnouncementConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      defaultRoleId: 'r-1',
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.AnnouncementConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.AnnouncementConfig.saveCalls[0].defaultRoleId).toBeNull();
  });

  test('StaffRole: removes all rows with matching role', async () => {
    fakeRepos.StaffRole.rows.set('1', { id: 1, guildId: 'g-1', role: 'r-1' });
    fakeRepos.StaffRole.rows.set('2', { id: 2, guildId: 'g-1', role: 'r-1' });
    fakeRepos.StaffRole.rows.set('3', {
      id: 3,
      guildId: 'g-1',
      role: 'unrelated',
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.StaffRole.removeCalls.length).toBe(1);
    expect(fakeRepos.StaffRole.removeCalls[0].length).toBe(2);
  });

  test('XPConfig: filters role out of ignoredRoles array', async () => {
    fakeRepos.XPConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      ignoredRoles: ['r-1', 'r-2', 'r-3'],
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-2' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.XPConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.XPConfig.saveCalls[0].ignoredRoles).toEqual(['r-1', 'r-3']);
  });

  test('XPConfig: skips save when role is not in ignoredRoles', async () => {
    fakeRepos.XPConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      ignoredRoles: ['r-2', 'r-3'],
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.XPConfig.saveCalls.length).toBe(0);
  });

  test('XPRoleReward: removes all rewards bound to the role', async () => {
    fakeRepos.XPRoleReward.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      roleId: 'r-1',
      level: 5,
    });
    fakeRepos.XPRoleReward.rows.set('2', {
      id: 2,
      guildId: 'g-1',
      roleId: 'r-1',
      level: 10,
    });
    fakeRepos.XPRoleReward.rows.set('3', {
      id: 3,
      guildId: 'g-1',
      roleId: 'other',
      level: 5,
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.XPRoleReward.removeCalls.length).toBe(1);
    expect(fakeRepos.XPRoleReward.removeCalls[0].length).toBe(2);
  });

  test('OnboardingConfig: nullifies completionRoleId when matching', async () => {
    fakeRepos.OnboardingConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      completionRoleId: 'r-1',
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.OnboardingConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.OnboardingConfig.saveCalls[0].completionRoleId).toBeNull();
  });

  test('BaitChannelConfig: filters whitelistedRoles + flushes manager cache', async () => {
    fakeRepos.BaitChannelConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      whitelistedRoles: ['r-1', 'r-2'],
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    expect(fakeRepos.BaitChannelConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.BaitChannelConfig.saveCalls[0].whitelistedRoles).toEqual(['r-2']);
    expect(mockClient.baitChannelManager.clearConfigCache).toHaveBeenCalledWith('g-1');
  });

  test('Promise.allSettled: one cleaner failing does not abort siblings', async () => {
    fakeRepos.BotConfig.shouldThrowOn = 'findOneBy';
    fakeRepos.RulesConfig.rows.set('1', {
      id: 1,
      guildId: 'g-1',
      roleId: 'r-1',
    });
    const role = makeRole({ guildId: 'g-1', roleId: 'r-1' });
    await roleDeleteHandler.execute(role, mockClient);
    // Sibling RulesConfig still got cleaned up despite BotConfig blowing up
    expect(fakeRepos.RulesConfig.removeCalls.length).toBe(1);
    expect(fakeInvalidateRulesCache).toHaveBeenCalledWith('g-1');
  });
});
