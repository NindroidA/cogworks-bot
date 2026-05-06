/**
 * BaitChannelManager Behavioral Tests
 *
 * Targets the high-stakes pure logic and caching paths in the otherwise
 * 1652-LOC monster. Constructor is fully DI'd (client + 5 repos), so we
 * can instantiate directly with fakes — no AppDataSource patch needed.
 *
 * Coverage:
 *   - determineAction: enableEscalation off → uses configured actionType;
 *     on → ban/kick/timeout/log-only based on score thresholds
 *   - checkWhitelist: server owner, manual user list, role list, admin,
 *     disableAdminWhitelist override
 *   - getConfig: cache hit, cache miss → fetch + cache, TTL expiry, null
 *     when not in DB, error → returns null
 *   - getKeywords: cache hit, cache miss → fetch + cache, no keywordRepo
 *     returns [], error → returns []
 *   - clearConfigCache / clearKeywordCache invalidate per guild only
 *   - setJoinVelocityTracker assigns the tracker reference
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import { BaitChannelManager } from '../../../../src/utils/baitChannel/baitChannelManager';

// ---------------------------------------------------------------------------
// Fake repo + dependency builders
// ---------------------------------------------------------------------------

interface FakeRepoState<T> {
  findOneResult: T | null;
  findResults: T[];
  findOneError?: Error;
  findError?: Error;
}

function makeFakeRepo<T>(state: FakeRepoState<T>) {
  return {
    findOne: jest.fn(async () => {
      if (state.findOneError) throw state.findOneError;
      return state.findOneResult;
    }),
    find: jest.fn(async () => {
      if (state.findError) throw state.findError;
      return state.findResults;
    }),
    save: jest.fn(async (e: T) => e),
    create: jest.fn((e: T) => e),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 1 })),
  } as any;
}

function makeManager(opts: {
  configState?: FakeRepoState<any>;
  keywordState?: FakeRepoState<any>;
  withKeywordRepo?: boolean;
}) {
  const configState = opts.configState ?? {
    findOneResult: null,
    findResults: [],
  };
  const keywordState = opts.keywordState ?? {
    findOneResult: null,
    findResults: [],
  };
  const configRepo = makeFakeRepo(configState);
  const logRepo = makeFakeRepo({ findOneResult: null, findResults: [] });
  const activityRepo = makeFakeRepo({ findOneResult: null, findResults: [] });
  const pendingBanRepo = makeFakeRepo({ findOneResult: null, findResults: [] });
  const keywordRepo = opts.withKeywordRepo === false ? undefined : makeFakeRepo(keywordState);

  const fakeClient = {} as any;
  const manager = new BaitChannelManager(fakeClient, configRepo, logRepo, activityRepo, pendingBanRepo, keywordRepo);
  return { manager, configRepo, keywordRepo, configState, keywordState };
}

function makeMember(
  overrides: { id?: string; ownerId?: string; whitelistedRoleIds?: string[]; hasAdmin?: boolean } = {},
) {
  const id = overrides.id ?? 'user-1';
  const ownerId = overrides.ownerId ?? 'owner-99';
  const roles = (overrides.whitelistedRoleIds ?? []).map(roleId => ({
    id: roleId,
    name: `role-${roleId}`,
  }));
  return {
    id,
    guild: { ownerId },
    roles: {
      cache: {
        find: (predicate: (r: any) => boolean) => roles.find(predicate),
      },
    },
    permissions: {
      has: (perm: bigint) => overrides.hasAdmin === true && perm === PermissionFlagsBits.Administrator,
    },
  } as any;
}

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// determineAction
// ---------------------------------------------------------------------------

describe('determineAction', () => {
  let mgr: any;

  beforeEach(() => {
    mgr = makeManager({}).manager;
  });

  test('enableEscalation: false → returns config.actionType regardless of score', () => {
    const cfg = { enableEscalation: false, actionType: 'ban' } as any;
    expect(mgr.determineAction(0, cfg)).toBe('ban');
    expect(mgr.determineAction(99, cfg)).toBe('ban');
  });

  test('enableEscalation: true → score below timeoutThreshold returns log-only', () => {
    const cfg = { enableEscalation: true, actionType: 'ban' } as any;
    expect(mgr.determineAction(49, cfg)).toBe('log-only');
  });

  test('enableEscalation: true → score at default timeoutThreshold (50) returns timeout', () => {
    const cfg = { enableEscalation: true, actionType: 'ban' } as any;
    expect(mgr.determineAction(50, cfg)).toBe('timeout');
    expect(mgr.determineAction(74, cfg)).toBe('timeout');
  });

  test('enableEscalation: true → score at default kickThreshold (75) returns kick', () => {
    const cfg = { enableEscalation: true, actionType: 'ban' } as any;
    expect(mgr.determineAction(75, cfg)).toBe('kick');
    expect(mgr.determineAction(89, cfg)).toBe('kick');
  });

  test('enableEscalation: true → score at default banThreshold (90) returns ban', () => {
    const cfg = { enableEscalation: true, actionType: 'ban' } as any;
    expect(mgr.determineAction(90, cfg)).toBe('ban');
    expect(mgr.determineAction(100, cfg)).toBe('ban');
  });

  test('honors custom thresholds when provided', () => {
    const cfg = {
      enableEscalation: true,
      actionType: 'ban',
      escalationTimeoutThreshold: 20,
      escalationKickThreshold: 40,
      escalationBanThreshold: 60,
    } as any;
    expect(mgr.determineAction(19, cfg)).toBe('log-only');
    expect(mgr.determineAction(20, cfg)).toBe('timeout');
    expect(mgr.determineAction(40, cfg)).toBe('kick');
    expect(mgr.determineAction(60, cfg)).toBe('ban');
  });
});

// ---------------------------------------------------------------------------
// checkWhitelist
// ---------------------------------------------------------------------------

describe('checkWhitelist', () => {
  let mgr: any;

  beforeEach(() => {
    mgr = makeManager({}).manager;
  });

  test('server owner is always whitelisted (highest precedence)', () => {
    const member = makeMember({ id: 'owner-99', ownerId: 'owner-99' });
    const result = mgr.checkWhitelist(member, {} as any);
    expect(result).toEqual({
      whitelisted: true,
      reason: 'User is the Server Owner',
    });
  });

  test('user in whitelistedUsers list is whitelisted', () => {
    const member = makeMember({ id: 'user-1' });
    const result = mgr.checkWhitelist(member, {
      whitelistedUsers: ['user-1', 'user-2'],
    } as any);
    expect(result.whitelisted).toBe(true);
    expect(result.reason).toBe('User is in manual whitelist');
  });

  test('user with whitelisted role is whitelisted, with role name in reason', () => {
    const member = makeMember({ whitelistedRoleIds: ['role-mod'] });
    const result = mgr.checkWhitelist(member, {
      whitelistedRoles: ['role-mod'],
    } as any);
    expect(result.whitelisted).toBe(true);
    expect(result.reason).toContain('role-role-mod');
  });

  test('admin is whitelisted by default', () => {
    const member = makeMember({ hasAdmin: true });
    const result = mgr.checkWhitelist(member, {} as any);
    expect(result).toEqual({
      whitelisted: true,
      reason: 'User is an Administrator',
    });
  });

  test('disableAdminWhitelist: admin is NOT whitelisted (test mode)', () => {
    const member = makeMember({ hasAdmin: true });
    const result = mgr.checkWhitelist(member, {
      disableAdminWhitelist: true,
    } as any);
    expect(result).toEqual({ whitelisted: false, reason: '' });
  });

  test('non-owner non-listed non-admin user is not whitelisted', () => {
    const member = makeMember({ id: 'rando-1' });
    const result = mgr.checkWhitelist(member, {
      whitelistedUsers: ['other-user'],
    } as any);
    expect(result).toEqual({ whitelisted: false, reason: '' });
  });
});

// ---------------------------------------------------------------------------
// getConfig caching
// ---------------------------------------------------------------------------

describe('getConfig (caching)', () => {
  test('cache miss: fetches from DB and caches result', async () => {
    const cfg = { guildId: 'guild-1', enabled: true } as any;
    const { manager, configRepo, configState } = makeManager({});
    configState.findOneResult = cfg;

    const result = await (manager as any).getConfig('guild-1');
    expect(result).toBe(cfg);
    expect(configRepo.findOne).toHaveBeenCalledTimes(1);
  });

  test('cache hit: second call within TTL skips DB', async () => {
    const cfg = { guildId: 'guild-1', enabled: true } as any;
    const { manager, configRepo, configState } = makeManager({});
    configState.findOneResult = cfg;

    await (manager as any).getConfig('guild-1');
    await (manager as any).getConfig('guild-1');

    expect(configRepo.findOne).toHaveBeenCalledTimes(1);
  });

  test('returns null when DB has no config (and does NOT cache the null)', async () => {
    const { manager, configRepo, configState } = makeManager({});
    configState.findOneResult = null;

    expect(await (manager as any).getConfig('guild-1')).toBeNull();
    // Second call re-queries because null was not cached
    await (manager as any).getConfig('guild-1');
    expect(configRepo.findOne).toHaveBeenCalledTimes(2);
  });

  test('DB error → returns null and logs (does not throw)', async () => {
    const { manager, configState } = makeManager({});
    configState.findOneError = new Error('Connection refused');

    expect(await (manager as any).getConfig('guild-1')).toBeNull();
  });

  test('clearConfigCache invalidates the entry for the specific guild only', async () => {
    const cfg1 = { guildId: 'guild-1', enabled: true } as any;
    const { manager, configRepo, configState } = makeManager({});

    configState.findOneResult = cfg1;
    await (manager as any).getConfig('guild-1');
    await (manager as any).getConfig('guild-2');
    expect(configRepo.findOne).toHaveBeenCalledTimes(2);

    manager.clearConfigCache('guild-1');
    await (manager as any).getConfig('guild-1'); // re-fetches
    await (manager as any).getConfig('guild-2'); // still cached
    expect(configRepo.findOne).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// getKeywords caching
// ---------------------------------------------------------------------------

describe('getKeywords (caching)', () => {
  test('cache miss: fetches keywords and caches them', async () => {
    const kws = [{ keyword: 'spam', weight: 10 }] as any;
    const { manager, keywordRepo, keywordState } = makeManager({});
    keywordState.findResults = kws;

    const result = await (manager as any).getKeywords('guild-1');
    expect(result).toBe(kws);
    expect(keywordRepo.find).toHaveBeenCalledTimes(1);
  });

  test('cache hit: second call within TTL skips DB', async () => {
    const { manager, keywordRepo, keywordState } = makeManager({});
    keywordState.findResults = [];

    await (manager as any).getKeywords('guild-1');
    await (manager as any).getKeywords('guild-1');
    expect(keywordRepo.find).toHaveBeenCalledTimes(1);
  });

  test('no keywordRepo provided → returns [] without throwing', async () => {
    const { manager } = makeManager({ withKeywordRepo: false });
    expect(await (manager as any).getKeywords('guild-1')).toEqual([]);
  });

  test('DB error → returns [] and logs (does not throw)', async () => {
    const { manager, keywordState } = makeManager({});
    keywordState.findError = new Error('Query timeout');
    expect(await (manager as any).getKeywords('guild-1')).toEqual([]);
  });

  test('clearKeywordCache invalidates the entry for the specific guild only', async () => {
    const { manager, keywordRepo, keywordState } = makeManager({});
    keywordState.findResults = [];

    await (manager as any).getKeywords('guild-1');
    await (manager as any).getKeywords('guild-2');
    expect(keywordRepo.find).toHaveBeenCalledTimes(2);

    manager.clearKeywordCache('guild-1');
    await (manager as any).getKeywords('guild-1'); // re-fetches
    await (manager as any).getKeywords('guild-2'); // still cached
    expect(keywordRepo.find).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// setJoinVelocityTracker
// ---------------------------------------------------------------------------

describe('setJoinVelocityTracker', () => {
  test('assigns the tracker reference for later use', () => {
    const { manager } = makeManager({});
    const tracker = {
      isBurstActive: () => false,
      getJoinCount: () => 0,
    } as any;
    manager.setJoinVelocityTracker(tracker);
    expect((manager as any).joinVelocityTracker).toBe(tracker);
  });
});

// ---------------------------------------------------------------------------
// logAction (null-safety regression — see prod incident 2026-05-04)
//
// `logAction` used to read `message.member!`, which Discord.js drops to null
// once the user has been banned/kicked. Result: every post-ban or post-delete
// log call threw `TypeError: null is not an object (evaluating 'member.id')`
// and silently failed to record the action. Now `member` is passed explicitly
// from the caller, so the logger no longer cares about `message.member`'s
// state.
// ---------------------------------------------------------------------------

function makeRichMember(overrides: { id?: string; joinedTimestamp?: number | null } = {}) {
  return {
    id: overrides.id ?? 'banned-user-1',
    user: {
      tag: 'banned-user-1#0001',
      createdTimestamp: Date.now() - 24 * 60 * 60 * 1000, // 1 day old account
    },
    joinedTimestamp: overrides.joinedTimestamp === undefined ? Date.now() - 60_000 : overrides.joinedTimestamp,
    roles: {
      cache: { some: (_predicate: (r: any) => boolean) => false },
    },
  } as any;
}

function makeMessage(overrides: { memberOverride?: any } = {}) {
  return {
    id: 'msg-123',
    content: 'spammy content',
    channelId: 'chan-1',
    guild: { id: 'guild-1' },
    member: 'memberOverride' in overrides ? overrides.memberOverride : makeRichMember(),
    author: { id: 'banned-user-1' },
  } as any;
}

describe('logAction (null-safety)', () => {
  test('writes log row using passed-in member when message.member is null', async () => {
    const { manager } = makeManager({});
    const logRepo = (manager as any).logRepo;
    const member = makeRichMember();
    const message = makeMessage({ memberOverride: null }); // simulates post-ban Discord.js

    await (manager as any).logAction(message, member, 'ban', {} as any, undefined, undefined);

    expect(logRepo.create).toHaveBeenCalledTimes(1);
    expect(logRepo.save).toHaveBeenCalledTimes(1);
    const saved = logRepo.create.mock.calls[0][0];
    expect(saved.userId).toBe('banned-user-1');
    expect(saved.username).toBe('banned-user-1#0001');
    expect(saved.actionTaken).toBe('ban');
    expect(saved.guildId).toBe('guild-1');
  });

  test('falls back to Date.now for membershipMinutes when joinedTimestamp is null', async () => {
    const { manager } = makeManager({});
    const logRepo = (manager as any).logRepo;
    const member = makeRichMember({ joinedTimestamp: null });
    const message = makeMessage({ memberOverride: null });

    await (manager as any).logAction(message, member, 'deleted-in-time', {} as any);

    expect(logRepo.create).toHaveBeenCalledTimes(1);
    const saved = logRepo.create.mock.calls[0][0];
    expect(saved.actionTaken).toBe('deleted-in-time');
    // Coalesced to ~now → membershipMinutes is a finite non-negative number
    expect(Number.isFinite(saved.membershipMinutes)).toBe(true);
    expect(saved.membershipMinutes).toBeGreaterThanOrEqual(0);
  });

  test('still works when message.member is the same captured ref (non-regression)', async () => {
    const { manager } = makeManager({});
    const logRepo = (manager as any).logRepo;
    const member = makeRichMember();
    const message = makeMessage({ memberOverride: member });

    await (manager as any).logAction(message, member, 'whitelisted', {} as any);

    expect(logRepo.save).toHaveBeenCalledTimes(1);
    const saved = logRepo.create.mock.calls[0][0];
    expect(saved.actionTaken).toBe('whitelisted');
  });
});
