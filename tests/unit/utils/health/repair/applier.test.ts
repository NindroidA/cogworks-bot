/**
 * applyRepairPlan with every dependency injected: a fake store that records
 * calls and returns scripted outcomes, a fake guild for the proofs, and spies
 * for the cache flushes and the audit row. The lock cases use deferred
 * promises, never timers.
 */
import { describe, expect, test } from 'bun:test';
import { type ApplyDeps, applyRepairPlan, type RepairActor } from '../../../../../src/utils/health/repair/applier';
import { RepairBusyError, tryLockGuildRepair } from '../../../../../src/utils/health/repair/lock';
import type { RepairStore, StoreOutcome } from '../../../../../src/utils/health/repair/store';
import type { RepairPlan, RepairProof, RepairStep } from '../../../../../src/utils/health/repair/types';
import { makeFakeGuild } from '../../../../helpers/fakeGuild';
import { restError, withThreadFetch } from '../moderationHelpers';

const G = '100000000000000001';
const OTHER = '100000000000000002';
const ROLE = '200000000000000001';
const GONE_ROLE = '200000000000000666';
const GONE_CH = '300000000000000666';
const THREAD = '400000000000000001';
const GONE_THREAD = '400000000000000666';

const ACTOR: RepairActor = { userId: '900000000000000001', source: 'command', checkedAt: '2026-10-06T12:00:00.000Z' };

const guildOf = (id = G, available = true) => makeFakeGuild({ id, available, roles: [{ id: ROLE }] });

let nextId = 1;
function step(op: RepairStep['op'], proofs: RepairProof[], o: Partial<RepairStep> = {}): RepairStep {
  const id = nextId++;
  return {
    entity: 'XPConfig',
    where: { guildId: G, id },
    op,
    guard: { levelUpChannelId: GONE_CH },
    ...(op === 'set' ? { set: { levelUpChannelId: null } } : {}),
    proofs,
    keys: [`key-${id}`],
    ...o,
  };
}
const role = (id: string): RepairProof => ({ kind: 'role', id });
const plan = (steps: RepairStep[]): RepairPlan => ({ fixes: [], steps, unsupported: [] });

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A store that logs `op entity:id` and answers from `outcome` (default applied); a thrown error fails the step. */
function fakeStore(
  outcome: (step: { op: string; id: unknown }) => StoreOutcome | Promise<StoreOutcome> = () => 'applied',
) {
  const calls: string[] = [];
  const run = async (op: string, entity: string, where: Record<string, unknown>) => {
    calls.push(`${op} ${entity}:${where.id}`);
    return outcome({ op, id: where.id });
  };
  const store: RepairStore = {
    set: (entity, where) => run('set', entity, where),
    delete: (entity, where) => run('delete', entity, where),
    insert: (entity, values) => run('insert', entity, values),
  };
  return { store, calls };
}

function makeDeps(store: RepairStore, overrides: Partial<ApplyDeps> = {}) {
  const flushed: string[] = [];
  const audits: unknown[][] = [];
  const registered: string[] = [];
  const deps: Partial<ApplyDeps> = {
    store,
    invalidateGuildCaches: guildId => flushed.push(`guild ${guildId}`),
    invalidateBaitCaches: (_client, guildId) => flushed.push(`bait ${guildId}`),
    requestGuildCommandRefresh: guildId => flushed.push(`commands ${guildId}`),
    registerGuildCommands: async guildId => {
      registered.push(guildId);
    },
    writeAuditLog: async (...args) => {
      audits.push(args);
    },
    ...overrides,
  };
  return { deps, flushed, audits, registered };
}

describe('applyRepairPlan: outcomes', () => {
  test('store outcomes pass through; an object that is back skips its step', async () => {
    const guild = guildOf();
    const fetched = withThreadFetch(guild, [THREAD]);
    const steps = [
      step('set', [role(GONE_ROLE)]),
      step('set', [role(GONE_ROLE)]),
      step('delete', [role(GONE_ROLE)]),
      step('delete', [role(ROLE)]),
      step('delete', [{ kind: 'thread', id: GONE_THREAD }], { entity: 'MemoryItem' }),
      step('set', []),
    ];
    const [a, b, c, back, thread, noProof] = steps.map(s => s.where.id);
    const scripted: Record<string, StoreOutcome> = { [String(b)]: 'stale', [String(c)]: 'gone' };
    const { store, calls } = fakeStore(({ id }) => scripted[String(id)] ?? 'applied');
    const result = await applyRepairPlan(guild, plan(steps), ACTOR, makeDeps(store).deps);

    expect(result.results.map(r => [r.step.where.id, r.outcome])).toEqual([
      [a, 'applied'],
      [b, 'stale'],
      [noProof, 'applied'],
      [c, 'gone'],
      [back, 'skipped-not-missing'],
      [thread, 'applied'],
    ]);
    expect(calls).toEqual([
      `set XPConfig:${a}`,
      `set XPConfig:${b}`,
      `set XPConfig:${noProof}`,
      `delete XPConfig:${c}`,
      `delete MemoryItem:${thread}`,
    ]);
    expect(fetched).toEqual([GONE_THREAD]);
    expect(result.counts).toEqual({
      applied: 3,
      stale: 1,
      gone: 1,
      exists: 0,
      'skipped-not-missing': 1,
      'skipped-unverified': 0,
      failed: 0,
    });
  });

  test('an unavailable guild verifies nothing and writes nothing', async () => {
    const { store, calls } = fakeStore();
    const steps = [step('set', [role(GONE_ROLE)]), step('delete', [{ kind: 'thread', id: GONE_THREAD }])];
    const result = await applyRepairPlan(guildOf(G, false), plan(steps), ACTOR, makeDeps(store).deps);
    expect(result.results.map(r => r.outcome)).toEqual(['skipped-unverified', 'skipped-unverified']);
    expect(calls).toEqual([]);
  });

  test('Missing Access and server errors on the REST proof skip unverified; Unknown Channel applies', async () => {
    for (const [code, outcome] of [
      [50001, 'skipped-unverified'],
      [500, 'skipped-unverified'],
      [10003, 'applied'],
    ] as const) {
      const guild = guildOf();
      (guild.channels as unknown as Record<string, unknown>).fetch = async () => {
        throw restError(code);
      };
      const { store, calls } = fakeStore();
      const steps = [step('delete', [{ kind: 'thread', id: GONE_THREAD }], { entity: 'MemoryItem' })];
      const result = await applyRepairPlan(guild, plan(steps), ACTOR, makeDeps(store).deps);
      expect(result.results.map(r => r.outcome)).toEqual([outcome]);
      expect(calls.length).toBe(outcome === 'applied' ? 1 : 0);
    }
  });

  test('every proof of a merged step must still be missing', async () => {
    const { store, calls } = fakeStore();
    const steps = [step('set', [role(GONE_ROLE), role(ROLE)])];
    const result = await applyRepairPlan(guildOf(), plan(steps), ACTOR, makeDeps(store).deps);
    expect(result.results.map(r => r.outcome)).toEqual(['skipped-not-missing']);
    expect(calls).toEqual([]);
  });
});

describe('applyRepairPlan: inserts and commands', () => {
  const insert = (values: Record<string, unknown>) =>
    step('insert', [], { entity: 'AnnouncementTemplate', where: { guildId: G }, guard: {}, values });
  const command = () =>
    step('command', [], {
      entity: 'ApplicationCommand',
      where: { guildId: G },
      guard: {},
      command: 'registerGuildCommands',
    });

  test('they run after sets and deletes, the command last; an insert always names the target guild', async () => {
    const inserted: Record<string, unknown>[] = [];
    const { store, calls } = fakeStore();
    store.insert = async (entity, values) => {
      calls.push(`insert ${entity}`);
      inserted.push(values);
      return 'applied';
    };
    const { deps, registered } = makeDeps(store);
    const steps = [command(), insert({ name: 'welcome', guildId: OTHER }), step('delete', []), step('set', [])];
    const result = await applyRepairPlan(guildOf(), plan(steps), ACTOR, deps);
    expect(result.results.map(r => [r.step.op, r.outcome])).toEqual([
      ['set', 'applied'],
      ['delete', 'applied'],
      ['insert', 'applied'],
      ['command', 'applied'],
    ]);
    expect(calls).toEqual([
      `set XPConfig:${steps[3].where.id}`,
      `delete XPConfig:${steps[2].where.id}`,
      'insert AnnouncementTemplate',
    ]);
    expect(inserted).toEqual([{ name: 'welcome', guildId: G }]);
    expect(registered).toEqual([G]);
  });

  test('an insert on a taken key is exists and flushes nothing; a failing command fails only its step', async () => {
    const { store } = fakeStore(({ op }) => (op === 'insert' ? 'exists' : 'applied'));
    const { deps, flushed, audits } = makeDeps(store, {
      registerGuildCommands: async () => {
        throw new Error('rest 50001');
      },
    });
    const result = await applyRepairPlan(guildOf(), plan([insert({ name: 'welcome' }), command()]), ACTOR, deps);
    expect(result.results.map(r => [r.step.op, r.outcome, r.error])).toEqual([
      ['insert', 'exists', undefined],
      ['command', 'failed', 'rest 50001'],
    ]);
    expect(flushed).toEqual([]);
    expect((audits[0][3] as any).steps[0]).toMatchObject({ op: 'insert', values: { name: 'welcome' } });
  });

  test('a row step naming ApplicationCommand fails instead of reaching the store', async () => {
    const { store, calls } = fakeStore();
    const steps = [step('set', [], { entity: 'ApplicationCommand' })];
    const result = await applyRepairPlan(guildOf(), plan(steps), ACTOR, makeDeps(store).deps);
    expect(result.results.map(r => r.outcome)).toEqual(['failed']);
    expect(calls).toEqual([]);
  });
});

describe('applyRepairPlan: failures', () => {
  test('a failing step is recorded and the rest still run', async () => {
    const steps = [step('set', []), step('set', []), step('delete', [])];
    const failing = steps[0].where.id;
    const { store, calls } = fakeStore(({ id }) => {
      if (id === failing) throw new Error('deadlock');
      return 'applied';
    });
    const result = await applyRepairPlan(guildOf(), plan(steps), ACTOR, makeDeps(store).deps);
    expect(result.results.map(r => r.outcome)).toEqual(['failed', 'applied', 'applied']);
    expect(result.results[0].error).toBe('deadlock');
    expect(calls).toHaveLength(3);
  });

  test('a plan with a step for another guild is refused before any write, flush or audit', async () => {
    const { store, calls } = fakeStore();
    const { deps, flushed, audits } = makeDeps(store);
    const steps = [step('set', []), step('delete', [], { where: { guildId: OTHER, id: 1 } })];
    await expect(applyRepairPlan(guildOf(), plan(steps), ACTOR, deps)).rejects.toThrow(`for guild ${OTHER}`);
    expect([calls, flushed, audits]).toEqual([[], [], []]);
    const release = tryLockGuildRepair(G);
    expect(release).toBeFunction();
    release?.();
  });

  test('a dependency passed as undefined keeps its default', async () => {
    const guild = guildOf();
    withThreadFetch(guild, []);
    const { store, calls } = fakeStore();
    const steps = [step('delete', [{ kind: 'thread', id: GONE_THREAD }], { entity: 'MemoryItem' })];
    const result = await applyRepairPlan(guild, plan(steps), ACTOR, makeDeps(store, { rest: undefined }).deps);
    expect(result.results.map(r => r.outcome)).toEqual(['applied']);
    expect(calls).toHaveLength(1);
  });
});

describe('applyRepairPlan: caches and audit', () => {
  test('caches are flushed once when something applied', async () => {
    const { store } = fakeStore();
    const { deps, flushed } = makeDeps(store);
    await applyRepairPlan(guildOf(), plan([step('set', []), step('delete', []), step('set', [])]), ACTOR, deps);
    expect(flushed).toEqual([`guild ${G}`, `bait ${G}`, `commands ${G}`]);
  });

  test('nothing applied, nothing flushed', async () => {
    const { store } = fakeStore(() => 'stale');
    const { deps, flushed, audits } = makeDeps(store);
    await applyRepairPlan(guildOf(), plan([step('set', []), step('delete', [role(ROLE)])]), ACTOR, deps);
    expect(flushed).toEqual([]);
    expect(audits).toHaveLength(1);
  });

  test('one audit row to the target guild, with codes and clipped values', async () => {
    const { store } = fakeStore();
    const long = Array.from({ length: 30 }, (_, i) => `30000000000000${String(i).padStart(4, '0')}`);
    const first = step('set', [], { set: { ignoredChannels: long }, guard: { ignoredChannels: [...long, GONE_CH] } });
    const fixes = [{ key: first.keys[0], code: 'xp.config.ignored_channel_missing' }] as RepairPlan['fixes'];
    const { deps, audits } = makeDeps(store);
    const dashboard: RepairActor = { ...ACTOR, source: 'dashboard' };
    await applyRepairPlan(guildOf(), { ...plan([first]), fixes }, dashboard, deps);

    expect(audits).toHaveLength(1);
    const [guildId, action, userId, details, source] = audits[0] as [string, string, string, any, string];
    expect([guildId, action, userId, source]).toEqual([G, 'bot-health.repair', ACTOR.userId, 'dashboard']);
    expect(details.checkedAt).toBe(ACTOR.checkedAt);
    expect(details.counts.applied).toBe(1);
    expect(details.stepsOmitted).toBeUndefined();
    const [entry] = details.steps;
    expect(entry).toMatchObject({ entity: 'XPConfig', rowId: first.where.id, op: 'set', outcome: 'applied' });
    expect(entry.codes).toEqual(['xp.config.ignored_channel_missing']);
    expect(entry.set.ignoredChannels).toHaveLength(200);
    expect(entry.set.ignoredChannels.endsWith('…')).toBe(true);
    expect(entry.guard.ignoredChannels).toHaveLength(200);
  });

  test('the command source audits as command:bot-health:repair, at most 100 steps', async () => {
    const { store } = fakeStore();
    const { deps, audits } = makeDeps(store);
    const steps = Array.from({ length: 120 }, () => step('delete', []));
    await applyRepairPlan(guildOf(), plan(steps), ACTOR, deps);
    const [, action, , details, source] = audits[0] as [string, string, string, any, string];
    expect([action, source]).toEqual(['command:bot-health:repair', 'command']);
    expect(details.steps).toHaveLength(100);
    expect(details.stepsOmitted).toBe(20);
    expect(details.steps[0]).toMatchObject({ guard: { levelUpChannelId: GONE_CH }, codes: [steps[0].keys[0]] });
    expect(details.steps[0].set).toBeUndefined();
  });
});

describe('applyRepairPlan: guild lock', () => {
  test('a second repair of the same guild is refused while one runs; other guilds proceed', async () => {
    const started = deferred<void>();
    const finish = deferred<StoreOutcome>();
    const slow = fakeStore(() => {
      started.resolve();
      return finish.promise;
    });
    const running = applyRepairPlan(guildOf(), plan([step('set', [])]), ACTOR, makeDeps(slow.store).deps);
    await started.promise;

    const { store } = fakeStore();
    await expect(applyRepairPlan(guildOf(), plan([]), ACTOR, makeDeps(store).deps)).rejects.toBeInstanceOf(
      RepairBusyError,
    );
    const otherSteps = [step('set', [], { where: { guildId: OTHER, id: 1 } })];
    const other = await applyRepairPlan(guildOf(OTHER), plan(otherSteps), ACTOR, makeDeps(store).deps);
    expect(other.counts.applied).toBe(1);

    finish.resolve('applied');
    expect((await running).counts.applied).toBe(1);
    const again = await applyRepairPlan(guildOf(), plan([step('set', [])]), ACTOR, makeDeps(store).deps);
    expect(again.counts.applied).toBe(1);
  });

  test('the lock is released when the run throws', async () => {
    const { store } = fakeStore();
    const { deps } = makeDeps(store, {
      writeAuditLog: async () => {
        throw new Error('audit down');
      },
    });
    await expect(applyRepairPlan(guildOf(), plan([step('set', [])]), ACTOR, deps)).rejects.toThrow('audit down');
    const release = tryLockGuildRepair(G);
    expect(release).toBeFunction();
    release?.();
  });

  test('a throwing flush is logged; the other flushes and the audit row still happen', async () => {
    const boom = () => {
      throw new Error('cache bug');
    };
    for (const name of ['invalidateGuildCaches', 'invalidateBaitCaches', 'requestGuildCommandRefresh'] as const) {
      const { store } = fakeStore();
      const { deps, flushed, audits } = makeDeps(store, { [name]: boom });
      const result = await applyRepairPlan(guildOf(), plan([step('set', [])]), ACTOR, deps);
      expect(result.counts.applied).toBe(1);
      expect(flushed).toHaveLength(2);
      expect(audits).toHaveLength(1);
    }
  });
});
