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
 * real channel perms" items stay manual. The fakes are stateful (edits change
 * the overwrite, repos hand out row copies) so a bot restart can be simulated
 * with a second manager over the same store.
 */

import { describe, expect, jest, test } from 'bun:test';
import { RaidModeManager } from '../../../../src/utils/baitChannel/raidModeManager';

const EVERYONE = 'everyone-role-id';

// A fake text channel with a configurable prior @everyone SendMessages overwrite.
// priorSend: true = explicit allow, false = explicit deny, null = no overwrite (inherit).
// Edits update the overwrite, like Discord does.
function makeChannel(id: string, name: string, priorSend: boolean | null) {
  const overwriteCache = new Map<string, unknown>();
  const setSend = (value: boolean | null | undefined) => {
    if (value === true || value === false) {
      overwriteCache.set(EVERYONE, { allow: { has: () => value === true }, deny: { has: () => value === false } });
    } else {
      overwriteCache.delete(EVERYONE);
    }
  };
  setSend(priorSend);
  const editValues: Array<boolean | null | undefined> = [];
  return {
    id,
    name,
    isTextBased: () => true,
    permissionOverwrites: {
      cache: overwriteCache,
      edit: jest.fn(async (_role: unknown, opts: { SendMessages?: boolean | null }) => {
        await Promise.resolve(); // yield like a REST call, so concurrent sweeps can interleave
        editValues.push(opts.SendMessages);
        setSend(opts.SendMessages);
      }),
    },
    editValues,
    setSend,
  };
}

/** Current @everyone SendMessages state of a fake channel. */
function sendState(ch: FakeChannel): boolean | null {
  const ow = ch.permissionOverwrites.cache.get(EVERYONE) as { allow: { has: () => boolean } } | undefined;
  return ow ? ow.allow.has() : null;
}

type FakeChannel = ReturnType<typeof makeChannel>;

function makeCache(channels: FakeChannel[]): any {
  const map = new Map(channels.map(c => [c.id, c]));
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

// The "database": one config row plus the bait log, shared across manager instances (= restarts).
function makeStore(config: any) {
  return { row: { ...config }, logs: [] as any[] };
}

// Honors the two TypeORM operators the manager queries `currentRaidModeUntil` with.
function matchesUntil(op: any, until: Date | null): boolean {
  if (!op) return true;
  if (!until) return false;
  if (op.type === 'lessThanOrEqual') return until.getTime() <= op.value.getTime();
  if (op.type === 'moreThan') return until.getTime() > op.value.getTime();
  throw new Error(`unexpected operator ${op.type}`);
}

function makeManager(config: any, store = makeStore(config)) {
  const configRepo = {
    findOne: jest.fn(async () => ({ ...store.row })),
    find: jest.fn(async (opts: any = {}) =>
      matchesUntil(opts.where?.currentRaidModeUntil, store.row.currentRaidModeUntil) ? [{ ...store.row }] : [],
    ),
    save: jest.fn(async (c: any) => {
      store.row = { ...c };
      return c;
    }),
  };
  const logRepo = {
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => {
      store.logs.push({ ...x, id: store.logs.length + 1 });
      return x;
    }),
    // Newest first, like `order: { createdAt: 'DESC', id: 'DESC' }`.
    find: jest.fn(async (opts: any) =>
      store.logs.filter(l => l.guildId === opts.where.guildId && l.actionTaken === opts.where.actionTaken).reverse(),
    ),
  };
  const mgr = new RaidModeManager({ configRepo, logRepo } as any);
  return { mgr, configRepo, logRepo, store };
}

describe('RaidModeManager', () => {
  describe('getStatus', () => {
    test('stays active past the cap until the lockdown is actually released', async () => {
      const config = makeConfig({ currentRaidModeUntil: new Date(Date.now() - 1000) });
      const { mgr } = makeManager(config);
      const guild = makeGuild('g1', [makeChannel('c', 'general', null)]);
      expect((await mgr.getStatus('g1')).active).toBe(true); // channels are still locked
      await mgr.checkAutoRelease(guild);
      expect((await mgr.getStatus('g1')).active).toBe(false);
    });

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
      const { mgr, configRepo, logRepo, store } = makeManager(config);

      const released = await mgr.releaseRaidMode(guild, 'mod-1', 'all clear');
      expect(released).toBe(true);
      expect(store.row.currentRaidModeUntil).toBeNull();
      expect(configRepo.save).toHaveBeenCalled();
      expect(logRepo.save).toHaveBeenCalled(); // raid-mode-released meta row
    });

    test('checkAutoRelease releases when the duration cap has elapsed', async () => {
      const config = makeConfig({ currentRaidModeUntil: new Date(Date.now() - 1000) });
      const ch = makeChannel('c', 'general', null);
      const guild = makeGuild('g1', [ch]);
      const { mgr, configRepo, store } = makeManager(config);

      await mgr.checkAutoRelease(guild);
      expect(store.row.currentRaidModeUntil).toBeNull();
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

  describe('restart mid-raid (persisted snapshot)', () => {
    function threeChannels() {
      return [
        makeChannel('allow', 'general', true),
        makeChannel('none', 'chat', null),
        makeChannel('deny', 'news', false),
      ];
    }

    // Boot path: a fresh manager over the same store, wired like src/index.ts.
    async function reboot(config: any, store: any, guild: any) {
      const next = makeManager(config, store);
      next.mgr.setGuildFetcher(async () => guild);
      await next.mgr.restoreActiveLockdowns();
      next.mgr.stopAutoReleaseSweep();
      return next;
    }

    test('restore reuses the persisted priors, so a release after the restart restores them (not the lock)', async () => {
      const [allow, none, deny] = threeChannels();
      const guild = makeGuild('g1', [allow, none, deny]);
      const config = makeConfig();
      const { mgr, store } = makeManager(config);
      await mgr.enterRaidMode(guild, config);
      expect([allow, none, deny].map(sendState)).toEqual([false, false, false]);
      // Crash before #general's deny landed: the restore must re-lock it.
      allow.setSend(true);

      const { mgr: rebooted } = await reboot(config, store, guild);
      expect(sendState(allow)).toBe(false);

      expect(await rebooted.releaseRaidMode(guild, 'mod-1')).toBe(true);
      expect([allow, none, deny].map(sendState)).toEqual([true, null, false]);
    });

    test('a cap that elapsed while offline is released at boot with the real priors', async () => {
      const [allow, none, deny] = threeChannels();
      const guild = makeGuild('g1', [allow, none, deny]);
      const config = makeConfig();
      const { mgr, store } = makeManager(config);
      await mgr.enterRaidMode(guild, config);
      // Push both the row and its persisted `until` into the past by the same amount.
      const past = new Date(Date.now() - 1000);
      const entered = store.logs.find(l => l.actionTaken === 'raid-mode-entered');
      entered.messageContent = JSON.stringify({ ...JSON.parse(entered.messageContent), until: past });
      store.row.currentRaidModeUntil = past;

      await reboot(config, store, guild);
      expect(store.row.currentRaidModeUntil).toBeNull();
      expect([allow, none, deny].map(sendState)).toEqual([true, null, false]);
    });

    test('a snapshot from an earlier raid is never applied to the current one', async () => {
      const ch = makeChannel('c', 'general', true);
      const guild = makeGuild('g1', [ch]);
      const config = makeConfig();
      const { mgr, store } = makeManager(config);
      await mgr.enterRaidMode(guild, config);
      await mgr.releaseRaidMode(guild, 'mod-1');
      // A later raid locked by an older bot version (no snapshot row), then a restart.
      ch.setSend(false);
      store.row.currentRaidModeUntil = new Date(Date.now() + 60_000);

      const { mgr: rebooted } = await reboot(config, store, guild);
      await rebooted.releaseRaidMode(guild, 'mod-1');
      expect(sendState(ch)).toBeNull(); // unknown prior → inherit fallback, not the stale `true`
    });

    test('no persisted snapshot (raid entered before 3.16.5): locked channels fall back to inherit, open ones keep their prior', async () => {
      const locked = makeChannel('locked', 'general', false); // denied by the old version
      const open = makeChannel('open', 'chat', true); // a crash left it open
      const guild = makeGuild('g1', [locked, open]);
      const config = makeConfig({ currentRaidModeUntil: new Date(Date.now() + 60_000) });
      const { mgr } = await reboot(config, makeStore(config), guild);
      expect([sendState(locked), sendState(open)]).toEqual([false, false]);

      await mgr.releaseRaidMode(guild, 'mod-1');
      expect([sendState(locked), sendState(open)]).toEqual([null, true]);
    });
  });

  describe('auto-release and re-entry', () => {
    test('the sweep releases a lockdown past its cap and restores the channels', async () => {
      const ch = makeChannel('c', 'general', true);
      const guild = makeGuild('g1', [ch]);
      const config = makeConfig();
      const { mgr, store } = makeManager(config);
      mgr.setGuildFetcher(async () => guild);
      await mgr.enterRaidMode(guild, config);
      store.row.currentRaidModeUntil = new Date(Date.now() - 1000);

      mgr.startAutoReleaseSweep(5);
      for (let i = 0; i < 100 && store.row.currentRaidModeUntil; i++) await Bun.sleep(5);
      mgr.stopAutoReleaseSweep();

      expect(store.row.currentRaidModeUntil).toBeNull();
      expect(sendState(ch)).toBe(true);
      expect(store.logs.at(-1)).toMatchObject({ actionTaken: 'raid-mode-released' });
    });

    test('the sweep leaves a raid that is still within its cap alone', async () => {
      const config = makeConfig({ currentRaidModeUntil: new Date(Date.now() + 60_000) });
      const { mgr, store } = makeManager(config);
      mgr.setGuildFetcher(async () => makeGuild('g1', []));
      expect(await mgr.releaseExpired('system:auto-release')).toBe(0);
      expect(store.row.currentRaidModeUntil).not.toBeNull();
    });

    test('re-entering after the cap but before release keeps the original priors', async () => {
      const ch = makeChannel('c', 'general', true);
      const config = makeConfig();
      const { mgr, store } = makeManager(config);
      await mgr.enterRaidMode(makeGuild('g1', [ch]), config);
      store.row.currentRaidModeUntil = new Date(Date.now() - 1000); // expired, still locked

      // A channel created mid-raid with its own deny was never touched by the bot.
      const created = makeChannel('new', 'staff', false);
      const guild = makeGuild('g1', [ch, created]);
      await mgr.enterRaidMode(guild, { ...store.row });
      await mgr.releaseRaidMode(guild, 'mod-1');

      expect([sendState(ch), sendState(created)]).toEqual([true, false]);
    });

    test('an entry racing a release waits for it, so it snapshots the restored state', async () => {
      const ch = makeChannel('c', 'general', true);
      const guild = makeGuild('g1', [ch]);
      const config = makeConfig();
      const { mgr, store } = makeManager(config);
      await mgr.enterRaidMode(guild, config);

      await Promise.all([
        mgr.releaseRaidMode(guild, 'mod-1'),
        mgr.enterRaidMode(guild, { ...store.row, currentRaidModeUntil: null }),
      ]);
      expect(sendState(ch)).toBe(false);
      await mgr.releaseRaidMode(guild, 'mod-1');
      expect(sendState(ch)).toBe(true);
    });
  });
});
