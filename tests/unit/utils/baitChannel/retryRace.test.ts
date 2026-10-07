/**
 * Retry races on the real member chain (cogworks-bot#41, second review).
 *
 * Real BaitChannelManager chain, real RetryQueue, real executeBanAction and
 * the real guildMemberRemove drain, with in-memory repos and a fake guild
 * whose ban fires the member-remove event the way the gateway does. Each
 * test is a scenario where a copy of a pending row read before entering the
 * chain used to undo work done meanwhile: deleting an `unban` row (user
 * banned for good) or running a second unban.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { DiscordAPIError, SnowflakeUtil } from 'discord.js';
import guildMemberRemove from '../../../../src/events/guildMemberRemove';
import { AppDataSource } from '../../../../src/typeorm';
import { IdempotencyKey } from '../../../../src/typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../../../../src/typeorm/entities/bait/PendingAction';
import { BaitChannelManager } from '../../../../src/utils/baitChannel/baitChannelManager';
import { initRetryQueue, stopRetryQueue } from '../../../../src/utils/baitChannel/retryQueue';

const apiError = (code: number, status: number) =>
  new DiscordAPIError({ message: `error ${code}`, code }, code, status, 'DELETE', '/bans', {
    body: undefined,
    files: undefined,
  });

function opMatch(v: any, actual: any): boolean {
  if (v && typeof v === 'object' && '_type' in v) {
    if (v.type === 'isNull') return actual === null || actual === undefined;
    if (v.type === 'lessThan') return actual < v.value;
    throw new Error(`op ${v.type}`);
  }
  return actual === v;
}
const matches = (r: any, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => opMatch(v, r[k]));

/** pending_actions: every read returns a copy, as TypeORM does. */
function makePendingRepo() {
  let nextId = 100;
  const rows = new Map<number, any>();
  return {
    rows,
    create: (x: any) => ({ ...x }),
    find: async (o?: any) => [...rows.values()].filter(r => matches(r, o?.where ?? {})).map(r => ({ ...r })),
    findOne: async (o: any) => {
      const r = [...rows.values()].find(x => matches(x, o.where));
      return r ? { ...r } : null;
    },
    save: async (x: any) => {
      if (x.id == null) x.id = nextId++;
      rows.set(x.id, { attempts: 0, deadAt: null, ...x });
      return x;
    },
    remove: async (x: any) => {
      rows.delete(x.id);
      return x;
    },
    delete: async (w: any) => {
      for (const [k, r] of rows) if (matches(r, w)) rows.delete(k);
      return { affected: 1 };
    },
  };
}

function makeIdemRepo() {
  const rows: any[] = [];
  return {
    rows,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      if (rows.some(r => r.guildId === x.guildId && r.userId === x.userId && r.action === x.action)) {
        throw new Error('UNIQUE');
      }
      rows.push(x);
      return x;
    },
    find: async ({ where }: any) => rows.filter(r => matches(r, where)),
    findOne: async ({ where }: any) => rows.find(r => matches(r, where)) ?? null,
    delete: async (w: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], w)) rows.splice(i, 1);
      return { affected: 1 };
    },
    update: async (w: any, patch: any) => {
      for (const r of rows) if (matches(r, w)) Object.assign(r, patch);
      return { affected: 1 };
    },
  };
}

const pending = makePendingRepo();
const idem = makeIdemRepo();
let original: any;
beforeAll(() => {
  original = (AppDataSource as any).getRepository;
  (AppDataSource as any).getRepository = (e: unknown) =>
    e === PendingAction ? pending : e === IdempotencyKey ? idem : {};
});
afterAll(() => {
  (AppDataSource as any).getRepository = original;
  stopRetryQueue();
});
beforeEach(() => {
  pending.rows.clear();
  idem.rows.length = 0;
});

/** Let timers and the chain run (real timers only: CI's Bun reads the real clock in fake timers). */
const flush = async (ms = 100) => {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, ms / 10));
};

function world(opts: { unbanFailures?: number } = {}) {
  const state = {
    banned: false,
    banReason: null as string | null,
    isMember: true,
    unbanFailures: opts.unbanFailures ?? 0,
    unreadable: false,
    goneBeforeRemove: false, // a mod lifts the ban between our fetch and our remove
  };
  const events: string[] = [];
  const alerts: string[] = [];
  const ownerDms: string[] = [];
  const logs: any[] = [];
  const config: any = {
    guildId: 'g1',
    enabled: true,
    testMode: false,
    deleteMessageHours: 1,
    timeoutDurationMinutes: 60,
    logChannelId: 'log1',
  };
  const client: any = { user: { id: 'bot' } };
  const member: any = { id: 'u1', client };
  const guild: any = {
    id: 'g1',
    bans: {
      create: async (_u: string, o: { reason: string }) => {
        events.push('ban');
        state.banned = true;
        state.banReason = o.reason;
        if (state.isMember) {
          state.isMember = false;
          // The gateway's GUILD_MEMBER_REMOVE arrives after the REST call.
          setTimeout(() => void guildMemberRemove.execute(member), 0);
        }
      },
      remove: async () => {
        if (state.goneBeforeRemove) {
          state.banned = false;
          state.goneBeforeRemove = false;
        }
        if (state.unbanFailures > 0) {
          state.unbanFailures--;
          events.push('unban-500');
          throw apiError(0, 500);
        }
        if (!state.banned) throw apiError(10026, 404);
        events.push('unban');
        state.banned = false;
      },
      fetch: async () => {
        if (state.unreadable) throw apiError(0, 503);
        if (state.banned) return { user: { id: 'u1' }, reason: state.banReason };
        throw apiError(10026, 404);
      },
    },
    name: 'Test Guild',
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (t: string) => void alerts.push(t) }) },
    fetchOwner: async () => ({ send: async (t: string) => void ownerDms.push(t) }),
    members: {
      fetch: async () => {
        if (state.isMember) return member;
        throw new Error('Unknown Member');
      },
    },
  };
  member.guild = guild;
  client.guilds = { fetch: async () => guild, cache: new Map([['g1', guild]]) };
  const configRepo: any = { findOne: async () => config };
  const logRepo: any = {
    update: async (w: any, p: any) => {
      logs.push({ ...w, ...p });
      return { affected: 1 };
    },
  };
  const manager = new BaitChannelManager(client, configRepo, logRepo, {} as any, pending as any, undefined, idem as any);
  client.baitChannelManager = manager;
  const queue: any = initRetryQueue({ client, pendingActionRepo: pending as any, idempotencyRepo: idem as any, logRepo });
  return { state, events, alerts, ownerDms, logs, config, member, queue, manager };
}

const post = () => String(SnowflakeUtil.generate({ timestamp: Date.now() - 60_000 }));
const retryRow = (action: string) =>
  pending.save({
    guildId: 'g1',
    userId: 'u1',
    messageId: post(),
    channelId: 'c1',
    action,
    suspicionScore: 70,
    attempts: 1,
    deadAt: null,
    lastError: null,
    expiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(),
  });
const dueNow = () => {
  for (const r of pending.rows.values()) r.expiresAt = new Date(Date.now() - 1000);
};
const rows = () => [...pending.rows.values()].map(r => ({ action: r.action, attempts: r.attempts }));

describe('retries and leaves on the real member chain', () => {
  test('a softban retry that lands: the leave it causes does nothing more, and a later ban by someone else stays', async () => {
    const w = world();
    await retryRow('softban');
    await w.queue.tick();
    await flush();
    expect(w.events).toEqual(['ban', 'unban']);
    expect(rows()).toEqual([]);

    // Another bot bans the user; no audit entry is recorded.
    w.state.banned = true;
    w.state.banReason = 'spam (other bot)';
    dueNow();
    await w.queue.tick();
    await flush();
    expect(w.events).toEqual(['ban', 'unban']);
    expect(w.state.banned).toBe(true);
  });

  test('a softban retry whose unban fails once keeps its unban row, and the next tick lifts the ban', async () => {
    const w = world({ unbanFailures: 1 });
    await retryRow('softban');
    await w.queue.tick();
    await flush();
    expect(w.events).toEqual(['ban', 'unban-500']);
    expect(rows()).toEqual([{ action: 'unban', attempts: 2 }]);

    dueNow();
    await w.queue.tick();
    await flush();
    expect(w.state.banned).toBe(false);
    expect(rows()).toEqual([]);
  });

  test('a voluntary leave racing a due tick: one softban, no second unban later', async () => {
    const w = world();
    w.state.isMember = false; // left on their own
    await retryRow('timeout');
    await Promise.all([guildMemberRemove.execute(w.member), w.queue.tick()]);
    await flush();
    expect(w.events).toEqual(['ban', 'unban']);
    expect(rows()).toEqual([]);

    dueNow();
    await w.queue.tick();
    await flush();
    expect(w.events).toEqual(['ban', 'unban']);
  });

  test('a softban retry cut off between its ban and unban (restart) is finished, not dropped as "already banned"', async () => {
    const w = world();
    const row = await retryRow('softban');
    // Before the restart: the claim was made and the ban landed, the unban never ran.
    idem.rows.push({
      guildId: 'g1',
      userId: 'u1',
      action: `softban:${row.messageId}`,
      testMode: false,
      executorId: 'bot',
      expiresAt: new Date(Date.now() - 30_000 + 24 * 60 * 60 * 1000),
    });
    w.state.banned = true;
    w.state.banReason = 'Softban — cogworks:bait retry attempt=1 score=70';
    w.state.isMember = false;
    await w.queue.tick();
    expect(rows()).toEqual([{ action: 'unban', attempts: 2 }]);
    dueNow();
    await w.queue.tick();
    expect(w.events).toEqual(['unban']);
    expect(w.state.banned).toBe(false);
  });

  test('an unban that never succeeds dead-letters after 5 attempts and is never picked again', async () => {
    const w = world({ unbanFailures: 1000 });
    w.state.banned = true;
    w.state.banReason = 'Softban — cogworks:bait score=70';
    w.state.isMember = false;
    await w.queue.enqueue({ guildId: 'g1', userId: 'u1', messageId: post(), channelId: 'c1', action: 'unban', suspicionScore: 70 });
    for (let i = 0; i < 10 && [...pending.rows.values()].some(r => !r.deadAt); i++) {
      dueNow();
      await w.queue.tick();
    }
    expect([...pending.rows.values()][0]).toMatchObject({ attempts: 5 });
    expect([...pending.rows.values()][0].deadAt).toBeTruthy();
    dueNow();
    await w.queue.tick();
    expect(w.events.filter(e => e.startsWith('unban'))).toHaveLength(4);
  });

  test('a test-mode guild still lifts our own softban ban', async () => {
    const w = world();
    w.config.testMode = true;
    w.state.banned = true;
    w.state.banReason = 'Softban — cogworks:bait score=70';
    w.state.isMember = false;
    await w.queue.enqueue({ guildId: 'g1', userId: 'u1', messageId: post(), channelId: 'c1', action: 'unban', suspicionScore: 70 });
    dueNow();
    await w.queue.tick();
    expect(w.state.banned).toBe(false);
    expect(rows()).toEqual([]);
  });
});

/** Our softban for this row's post was cut off by a restart: its claim and its ban are in place, its unban never ran. */
const cutOff = (w: ReturnType<typeof world>, messageId: string) => {
  idem.rows.push({
    guildId: 'g1',
    userId: 'u1',
    action: `softban:${messageId}`,
    testMode: false,
    executorId: 'bot',
    expiresAt: new Date(Date.now() - 30_000 + 24 * 60 * 60 * 1000),
  });
  w.state.banned = true;
  w.state.banReason = 'Softban — cogworks:bait retry attempt=1 score=70';
  w.state.isMember = false;
};
const unbanRow = (w: ReturnType<typeof world>, messageId = post()) =>
  w.queue.enqueue({ guildId: 'g1', userId: 'u1', messageId, channelId: 'c1', action: 'unban', suspicionScore: 70 });
const ticks = async (w: ReturnType<typeof world>, n: number) => {
  for (let i = 0; i < n; i++) {
    dueNow();
    await w.queue.tick();
    await flush(20);
  }
};

describe('third review: never leave our ban in place, never act twice, never lift a ban we did not place', () => {
  test('ADV-1: a cut-off softban retry with test mode switched on during the downtime still lifts our ban', async () => {
    const w = world();
    cutOff(w, (await retryRow('softban')).messageId);
    w.config.testMode = true;
    await ticks(w, 3);
    expect(w.state.banned).toBe(false);
    expect(w.events).toEqual(['unban']);
    expect(rows()).toEqual([]);
  });

  test('ADV-2: a cut-off softban retry with the bait channel turned off during the downtime still lifts our ban', async () => {
    const w = world();
    cutOff(w, (await retryRow('softban')).messageId);
    w.config.enabled = false;
    await ticks(w, 3);
    expect(w.state.banned).toBe(false);
    expect(w.events).toEqual(['unban']);
  });

  test('ADV-3: the row save fails after the ban landed and the unban failed: the next tick finishes it, no second ban', async () => {
    const w = world({ unbanFailures: 1 });
    await retryRow('softban');
    const realSave = pending.save;
    (pending as any).save = async (x: any) => {
      if (x.action === 'unban') {
        (pending as any).save = realSave;
        throw new Error('db down');
      }
      return realSave(x);
    };
    await w.queue.tick();
    await flush();
    await ticks(w, 3);
    expect(w.events.filter(e => e === 'ban')).toHaveLength(1);
    expect(w.state.banned).toBe(false);
  });

  test('ADV-4: the row remove fails after a ban retry landed: the next tick does not ban again', async () => {
    const w = world();
    w.state.isMember = false;
    await retryRow('ban');
    const realRemove = pending.remove;
    (pending as any).remove = async () => {
      (pending as any).remove = realRemove;
      throw new Error('db down');
    };
    await w.queue.tick();
    await ticks(w, 1);
    expect(w.events.filter(e => e === 'ban')).toHaveLength(1);
    expect(rows()).toEqual([]);
  });

  test("ADV-5: an unban finds a ban with no reason (a mod, from Discord's UI) and keeps it", async () => {
    const w = world();
    w.state.banned = true;
    w.state.isMember = false;
    await unbanRow(w);
    await ticks(w, 1);
    expect(w.state.banned).toBe(true);
    expect(rows()).toEqual([]);
  });

  test('ADV-6: a retry for a member banned by our own softban for another post (its unban pending) never softbans again', async () => {
    const w = world();
    const a = post();
    w.state.isMember = false;
    w.state.banned = true;
    w.state.banReason = 'Softban — cogworks:bait score=90';
    idem.rows.push({ guildId: 'g1', userId: 'u1', action: `softban:${a}`, testMode: false, executorId: 'bot', expiresAt: new Date(Date.now() + 24 * 3600_000) });
    await unbanRow(w, a);
    await retryRow('timeout');
    await ticks(w, 2);
    expect(w.events.filter(e => e === 'ban')).toHaveLength(0);
    expect(w.state.banned).toBe(false);
  });

  test('ADV-7: test mode: queued ban and timeout (member left) rows are dry runs', async () => {
    const w = world();
    w.config.testMode = true;
    w.state.isMember = false;
    await retryRow('ban');
    await retryRow('timeout');
    await ticks(w, 2);
    expect(w.events).toEqual([]);
    expect(rows()).toEqual([]);
  });

  test('ADV-8: bait channel off: retries stand down through the tick and the leave-drain; an unban still runs', async () => {
    const w = world();
    w.config.enabled = false;
    await retryRow('ban');
    await w.queue.tick();
    w.state.isMember = false;
    await retryRow('kick');
    await guildMemberRemove.execute(w.member);
    await flush();
    expect(w.events).toEqual([]);
    w.state.banned = true;
    w.state.banReason = 'Softban — x';
    await unbanRow(w);
    await ticks(w, 1);
    expect(w.events).toEqual(['unban']);
  });

  test('ADV-9: a ban list that is never readable: a softban row dead-letters at 3 attempts, an unban row at 5', async () => {
    const w = world();
    w.state.isMember = false;
    w.state.unreadable = true;
    await retryRow('softban');
    await ticks(w, 6);
    const softban = [...pending.rows.values()][0];
    expect(softban).toMatchObject({ attempts: 3 });
    expect(softban.deadAt).toBeTruthy();
    pending.rows.clear();
    await unbanRow(w);
    await ticks(w, 8);
    const unban = [...pending.rows.values()][0];
    expect(unban).toMatchObject({ attempts: 5 });
    expect(unban.deadAt).toBeTruthy();
    expect(w.alerts).toHaveLength(1);
  });

  test('ADV-10: a mod lifts the ban between our fetch and our remove (10026): done, no dead-letter or alert', async () => {
    const w = world();
    w.state.banned = true;
    w.state.banReason = 'Softban — x';
    w.state.isMember = false;
    w.state.goneBeforeRemove = true;
    await unbanRow(w);
    await ticks(w, 1);
    expect(rows()).toEqual([]);
    expect(w.alerts).toEqual([]);
  });

  test('ADV-11: a busy member chain is skipped this tick and runs on the next', async () => {
    const w = world();
    w.state.isMember = false;
    await retryRow('ban');
    let release!: () => void;
    const gate = new Promise<void>(r => {
      release = r;
    });
    const busy = w.manager.inMemberChain('g1', 'u1', () => gate);
    await w.queue.tick();
    expect(w.events).toEqual([]);
    release();
    await busy;
    await flush();
    await ticks(w, 1);
    expect(w.events).toEqual(['ban']);
  });

  test('an unban that gives up in a guild without a bait log channel DMs the server owner', async () => {
    const w = world({ unbanFailures: 1000 });
    w.config.logChannelId = null;
    w.state.banned = true;
    w.state.banReason = 'Softban — x';
    w.state.isMember = false;
    await unbanRow(w);
    await ticks(w, 6);
    expect([...pending.rows.values()][0].deadAt).toBeTruthy();
    expect(w.alerts).toEqual([]);
    expect(w.ownerDms).toHaveLength(1);
    expect(w.ownerDms[0]).toContain('<@u1>');
    expect(w.ownerDms[0]).toContain('Test Guild');
  });
});
