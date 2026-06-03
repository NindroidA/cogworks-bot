/**
 * RaidModeManager behavioral tests.
 *
 * Covers the sticky-lockdown lifecycle (enter / release / auto-release /
 * status / threshold-triggered entry) and — most importantly — the channel
 * permission SNAPSHOT/RESTORE logic: release must restore each channel's
 * prior @everyone SendMessages tri-state exactly, never blindly flatten an
 * explicit allow to inherit.
 *
 * Automates smoke-test checklist §8 (raid mode). Discord-side fakes stand in
 * for the gateway/REST surface; the irreducible "look at the real audit log /
 * real channel perms" items stay manual.
 */

import { describe, expect, jest, test } from 'bun:test';
import { RaidModeManager } from '../../../../src/utils/baitChannel/raidModeManager';

const EVERYONE = 'everyone-role-id';

// A fake text channel with a configurable prior @everyone SendMessages overwrite.
// priorSend: true = explicit allow, false = explicit deny, null = no overwrite (inherit).
function makeChannel(id: string, name: string, priorSend: boolean | null) {
  const overwriteCache = new Map<string, unknown>();
  if (priorSend === true || priorSend === false) {
    overwriteCache.set(EVERYONE, {
      allow: { has: () => priorSend === true },
      deny: { has: () => priorSend === false },
    });
  }
  const editValues: Array<boolean | null | undefined> = [];
  return {
    id,
    name,
    isTextBased: () => true,
    permissionOverwrites: {
      cache: overwriteCache,
      edit: jest.fn(async (_role: unknown, opts: { SendMessages?: boolean | null }) => {
        editValues.push(opts.SendMessages);
      }),
    },
    editValues,
  };
}

type FakeChannel = ReturnType<typeof makeChannel>;

function makeCache(channels: FakeChannel[]): any {
  const map = new Map(channels.map((c) => [c.id, c]));
  return {
    filter: (fn: (c: FakeChannel) => boolean) => makeCache(channels.filter(fn)),
    values: () => map.values(),
    get size() {
      return map.size;
    },
    get: (id: string) => map.get(id),
  };
}

function makeGuild(id: string, channels: FakeChannel[]) {
  return {
    id,
    name: `Guild ${id}`,
    roles: { everyone: { id: EVERYONE } },
    channels: {
      cache: makeCache(channels),
      // Always null → sendRaidAlert short-circuits (no embed assertions here).
      fetch: jest.fn(async () => null),
    },
  } as any;
}

function makeConfig(overrides: Record<string, unknown> = {}): any {
  return {
    guildId: 'g1',
    enableRaidMode: true,
    raidModeThreshold: 3,
    raidModeWindowSeconds: 60,
    raidModeAlertRoleId: null,
    logChannelId: null, // skips sendRaidAlert
    summaryChannelId: null,
    channelIds: [],
    currentRaidModeUntil: null,
    ...overrides,
  };
}

function makeManager(config: any) {
  const configRepo = {
    findOne: jest.fn(async () => config),
    find: jest.fn(async () => [config]),
    save: jest.fn(async (c: any) => c),
  };
  const logRepo = {
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
  };
  const mgr = new RaidModeManager({ configRepo, logRepo } as any);
  return { mgr, configRepo, logRepo };
}

describe('RaidModeManager', () => {
  describe('getStatus', () => {
    test('inactive when currentRaidModeUntil is null', async () => {
      const config = makeConfig({ currentRaidModeUntil: null });
      const { mgr } = makeManager(config);
      const status = await mgr.getStatus('g1');
      expect(status.active).toBe(false);
      expect(status.until).toBeNull();
    });

    test('active when currentRaidModeUntil is in the future', async () => {
      const until = new Date(Date.now() + 60_000);
      const config = makeConfig({ currentRaidModeUntil: until });
      const { mgr } = makeManager(config);
      const status = await mgr.getStatus('g1');
      expect(status.active).toBe(true);
      expect(status.until).toEqual(until);
    });
  });

  describe('recordTrigger', () => {
    test('returns false below threshold and does not enter raid mode', async () => {
      const config = makeConfig({ raidModeThreshold: 3 });
      const { mgr, configRepo } = makeManager(config);
      const guild = makeGuild('g1', []);
      expect(await mgr.recordTrigger(guild, 'u1', config)).toBe(false);
      expect(await mgr.recordTrigger(guild, 'u2', config)).toBe(false);
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    test('enters raid mode when the threshold is reached (saves config + locks channels)', async () => {
      const config = makeConfig({ raidModeThreshold: 3 });
      const ch = makeChannel('c', 'general', null);
      const guild = makeGuild('g1', [ch]);
      const { mgr, configRepo } = makeManager(config);

      await mgr.recordTrigger(guild, 'u1', config);
      await mgr.recordTrigger(guild, 'u2', config);
      const entered = await mgr.recordTrigger(guild, 'u3', config);

      expect(entered).toBe(true);
      expect(config.currentRaidModeUntil).toBeInstanceOf(Date);
      expect(configRepo.save).toHaveBeenCalled();
      expect(ch.editValues).toEqual([false]); // channel locked down
    });

    test('no-op when enableRaidMode is false', async () => {
      const config = makeConfig({ enableRaidMode: false, raidModeThreshold: 1 });
      const { mgr, configRepo } = makeManager(config);
      const guild = makeGuild('g1', []);
      expect(await mgr.recordTrigger(guild, 'u1', config)).toBe(false);
      expect(configRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('channel permission snapshot/restore', () => {
    test('release RESTORES an explicit @everyone SendMessages:true overwrite (not inherit) — the perm-snapshot fix', async () => {
      const ch = makeChannel('c-allow', 'general', true); // explicit allow before raid
      const guild = makeGuild('g1', [ch]);
      const config = makeConfig();
      const { mgr } = makeManager(config);

      await mgr.enterRaidMode(guild, config);
      expect(ch.editValues).toEqual([false]); // denied during lockdown

      await mgr.releaseRaidMode(guild, 'mod-1');
      // MUST be restored to its prior `true`, NOT flattened to null/inherit.
      expect(ch.editValues).toEqual([false, true]);
    });

    test('release restores inherit (null) for a channel that had no prior overwrite', async () => {
      const ch = makeChannel('c-none', 'general', null);
      const guild = makeGuild('g1', [ch]);
      const config = makeConfig();
      const { mgr } = makeManager(config);

      await mgr.enterRaidMode(guild, config);
      expect(ch.editValues).toEqual([false]);
      await mgr.releaseRaidMode(guild, 'mod-1');
      expect(ch.editValues).toEqual([false, null]);
    });

    test('a channel already explicitly denied is not re-edited on lockdown and stays denied on release', async () => {
      const ch = makeChannel('c-deny', 'general', false);
      const guild = makeGuild('g1', [ch]);
      const config = makeConfig();
      const { mgr } = makeManager(config);

      await mgr.enterRaidMode(guild, config);
      expect(ch.editValues).toEqual([]); // already denied → skipped
      await mgr.releaseRaidMode(guild, 'mod-1');
      expect(ch.editValues).toEqual([false]); // restored to its prior deny
    });

    test('exempt channels (log / summary / bait) are never touched', async () => {
      const logCh = makeChannel('log', 'logs', true);
      const summaryCh = makeChannel('summary', 'summary', true);
      const baitCh = makeChannel('bait', 'bait', true);
      const normalCh = makeChannel('n', 'general', null);
      const guild = makeGuild('g1', [logCh, summaryCh, baitCh, normalCh]);
      const config = makeConfig({ logChannelId: 'log', summaryChannelId: 'summary', channelIds: ['bait'] });
      const { mgr } = makeManager(config);

      await mgr.enterRaidMode(guild, config);
      expect(logCh.editValues).toEqual([]);
      expect(summaryCh.editValues).toEqual([]);
      expect(baitCh.editValues).toEqual([]);
      expect(normalCh.editValues).toEqual([false]);
    });

    test('release with no snapshot (bot restarted mid-raid) falls back to inherit (null)', async () => {
      const ch = makeChannel('c', 'general', true);
      const guild = makeGuild('g1', [ch]);
      // Active in DB, but this manager instance never ran enterRaidMode → no in-memory snapshot.
      const config = makeConfig({ currentRaidModeUntil: new Date(Date.now() + 1000) });
      const { mgr } = makeManager(config);

      await mgr.releaseRaidMode(guild, 'mod-1');
      expect(ch.editValues).toEqual([null]); // safe fallback to inherit
    });
  });

  describe('releaseRaidMode / checkAutoRelease', () => {
    test('releaseRaidMode returns false when not active', async () => {
      const config = makeConfig({ currentRaidModeUntil: null });
      const { mgr } = makeManager(config);
      const guild = makeGuild('g1', []);
      expect(await mgr.releaseRaidMode(guild, 'mod')).toBe(false);
    });

    test('releaseRaidMode clears state + writes a meta-log when active', async () => {
      const ch = makeChannel('c', 'general', null);
      const guild = makeGuild('g1', [ch]);
      const config = makeConfig({ currentRaidModeUntil: new Date(Date.now() + 60_000) });
      const { mgr, configRepo, logRepo } = makeManager(config);

      const released = await mgr.releaseRaidMode(guild, 'mod-1', 'all clear');
      expect(released).toBe(true);
      expect(config.currentRaidModeUntil).toBeNull();
      expect(configRepo.save).toHaveBeenCalled();
      expect(logRepo.save).toHaveBeenCalled(); // raid-mode-released meta row
    });

    test('checkAutoRelease releases when the duration cap has elapsed', async () => {
      const config = makeConfig({ currentRaidModeUntil: new Date(Date.now() - 1000) });
      const ch = makeChannel('c', 'general', null);
      const guild = makeGuild('g1', [ch]);
      const { mgr, configRepo } = makeManager(config);

      await mgr.checkAutoRelease(guild);
      expect(config.currentRaidModeUntil).toBeNull();
      expect(configRepo.save).toHaveBeenCalled();
    });

    test('checkAutoRelease is a no-op while still within the cap', async () => {
      const future = new Date(Date.now() + 60_000);
      const config = makeConfig({ currentRaidModeUntil: future });
      const { mgr, configRepo } = makeManager(config);
      const guild = makeGuild('g1', []);

      await mgr.checkAutoRelease(guild);
      expect(config.currentRaidModeUntil).toEqual(future);
      expect(configRepo.save).not.toHaveBeenCalled();
    });
  });
});
