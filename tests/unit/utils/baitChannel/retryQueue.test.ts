/**
 * RetryQueue behavioral tests.
 *
 * Covers enqueue backoff/dead-letter math and the per-tick retry lifecycle
 * (executed → remove, duplicate → remove, queued → attempts++/backoff, failed
 * or MAX_ATTEMPTS → dead-letter, orphaned grace rows dropped (never run),
 * test mode → dry run, guild-gone → terminal), plus a real retry through the
 * real executor and settling the bait log row (cogworks-bot#41). The REST executor is injected (deps.executeBanAction) so we drive
 * outcomes without mock.module() — which is process-shared on bun and would
 * poison the sibling banExecutor suite.
 *
 * Automates smoke-test checklist §3 (retry queue).
 */

import { describe, expect, jest, test } from 'bun:test';
import { DiscordAPIError } from 'discord.js';
import { executeBanAction } from '../../../../src/utils/baitChannel/banExecutor';
import { ORPHAN_GRACE_MARGIN_MS, RetryQueue } from '../../../../src/utils/baitChannel/retryQueue';

function makeRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    guildId: 'g1',
    userId: 'u1',
    messageId: 'm1',
    channelId: 'c1',
    action: 'ban',
    suspicionScore: 95,
    attempts: 1,
    deadAt: null,
    lastError: null,
    warningMessageId: null,
    expiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

function makeQueue(opts: { due?: any[]; existing?: any; execResult?: any; member?: any } = {}) {
  const saved: any[] = [];
  const removed: any[] = [];
  const created: any[] = [];
  const pendingActionRepo = {
    // By id: the fresh read runRow makes inside the member chain. Otherwise: enqueue's lookup.
    findOne: jest.fn(async ({ where }: any) =>
      where.id !== undefined
        ? ((opts.due ?? []).find(r => r.id === where.id && r.guildId === where.guildId) ?? null)
        : (opts.existing ?? null),
    ),
    find: jest.fn(async () => opts.due ?? []),
    create: jest.fn((x: any) => {
      created.push(x);
      return x;
    }),
    save: jest.fn(async (x: any) => {
      saved.push(x);
      return x;
    }),
    remove: jest.fn(async (x: any) => {
      removed.push(x);
      return x;
    }),
  };
  const fakeGuild = {
    id: 'g1',
    members: { fetch: jest.fn(async () => ('member' in opts ? opts.member : { id: 'u1' })) },
  };
  const client = { user: { id: 'bot' }, guilds: { fetch: jest.fn(async () => fakeGuild) } };
  const executeBanAction = jest.fn(async () => opts.execResult ?? { status: 'executed' });
  const logRepo = { update: jest.fn(async () => ({ affected: 1 })) };
  const mgr = new RetryQueue({
    client,
    pendingActionRepo,
    idempotencyRepo: {},
    executeBanAction,
    logRepo,
  } as any);
  return { mgr, pendingActionRepo, executeBanAction, saved, removed, created, client, logRepo };
}

/** Idempotency repo fake with the UNIQUE (guildId, userId, action) collision the real table has (same day). */
function makeIdempotencyRepo() {
  const rows: any[] = [];
  const matches = (r: any, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (x: any) => x,
    save: jest.fn(async (x: any) => {
      if (rows.some(r => r.guildId === x.guildId && r.userId === x.userId && r.action === x.action)) {
        throw new Error('UNIQUE constraint failed (test fake)');
      }
      rows.push(x);
      return x;
    }),
    find: jest.fn(async ({ where }: any) => rows.filter(r => matches(r, where))),
    findOne: jest.fn(async ({ where }: any) => rows.find(r => matches(r, where)) ?? null),
    delete: jest.fn(async (where: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { affected: 1 };
    }),
    update: jest.fn(async () => ({ affected: 1 })),
  };
}

describe('RetryQueue', () => {
  describe('enqueue', () => {
    test('creates a fresh retry row with attempts=1 and ~5s backoff', async () => {
      const { mgr, created } = makeQueue({ existing: null });
      await mgr.enqueue({
        guildId: 'g1',
        userId: 'u1',
        messageId: 'm1',
        channelId: 'c1',
        action: 'ban',
        suspicionScore: 95,
        lastError: '429',
      });
      expect(created).toHaveLength(1);
      expect(created[0].attempts).toBe(1);
      const delta = created[0].expiresAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(3_000);
      expect(delta).toBeLessThan(6_000);
    });

    test('increments an existing row and applies the next (30s) backoff', async () => {
      const existing = makeRow({ attempts: 1 });
      const { mgr, saved } = makeQueue({ existing });
      await mgr.enqueue({
        guildId: 'g1',
        userId: 'u1',
        messageId: 'm1',
        channelId: 'c1',
        action: 'ban',
        suspicionScore: 95,
        lastError: '429',
      });
      expect(existing.attempts).toBe(2);
      expect(existing.deadAt == null).toBe(true);
      const delta = existing.expiresAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(25_000);
      expect(delta).toBeLessThan(35_000);
      expect(saved).toContain(existing);
    });

    test('dead-letters an existing row once it reaches MAX_ATTEMPTS', async () => {
      const existing = makeRow({ attempts: 2 }); // +1 → 3 = MAX
      const { mgr } = makeQueue({ existing });
      await mgr.enqueue({
        guildId: 'g1',
        userId: 'u1',
        messageId: 'm1',
        channelId: 'c1',
        action: 'ban',
        suspicionScore: 95,
        lastError: 'timeout',
      });
      expect(existing.attempts).toBe(3);
      expect(existing.deadAt).toBeInstanceOf(Date);
    });
  });

  describe('tick / retry lifecycle', () => {
    test('executed action removes the row', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, removed, executeBanAction } = makeQueue({ due: [row], execResult: { status: 'executed' } });
      await (mgr as any).tick();
      expect(executeBanAction).toHaveBeenCalled();
      expect(removed).toContain(row);
    });

    test('duplicate (already done elsewhere) removes the row', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, removed } = makeQueue({ due: [row], execResult: { status: 'duplicate' } });
      await (mgr as any).tick();
      expect(removed).toContain(row);
    });

    test('still-queued increments attempts + sets the next backoff (row kept)', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, removed, saved } = makeQueue({ due: [row], execResult: { status: 'queued', failureReason: '429' } });
      await (mgr as any).tick();
      expect(removed).not.toContain(row);
      expect(row.attempts).toBe(2);
      expect(row.deadAt).toBeNull();
      expect(saved).toContain(row);
    });

    test('terminal failure dead-letters the row', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, saved } = makeQueue({ due: [row], execResult: { status: 'failed', failureReason: 'missing perms' } });
      await (mgr as any).tick();
      expect(row.deadAt).toBeInstanceOf(Date);
      expect(row.lastError).toBe('missing perms');
      expect(saved).toContain(row);
    });

    test('reaching MAX_ATTEMPTS dead-letters even on a retryable status', async () => {
      const row = makeRow({ attempts: 2 }); // +1 → 3 = MAX
      const { mgr } = makeQueue({ due: [row], execResult: { status: 'queued', failureReason: '429' } });
      await (mgr as any).tick();
      expect(row.attempts).toBe(3);
      expect(row.deadAt).toBeInstanceOf(Date);
    });

    test('orphaned grace row (attempts=0) past the margin is dropped, never executed', async () => {
      const row = makeRow({ attempts: 0, expiresAt: new Date(Date.now() - ORPHAN_GRACE_MARGIN_MS - 1000) });
      const { mgr, removed, executeBanAction } = makeQueue({ due: [row], execResult: { status: 'executed' } });
      await (mgr as any).tick();
      expect(executeBanAction).not.toHaveBeenCalled();
      expect(removed).toContain(row);
    });

    test('grace row just past expiresAt is left to the live timer (no race)', async () => {
      const row = makeRow({ attempts: 0, expiresAt: new Date(Date.now() - 200) });
      const { mgr, removed, executeBanAction } = makeQueue({ due: [row] });
      await (mgr as any).tick();
      expect(executeBanAction).not.toHaveBeenCalled();
      expect(removed).not.toContain(row);
    });

    test('retry in a test-mode guild is a dry run', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, executeBanAction } = makeQueue({ due: [row] });
      (mgr as any).deps.getConfig = jest.fn(async () => ({ enabled: true, testMode: true, deleteMessageHours: 2 }));
      await (mgr as any).tick();
      const opts = (executeBanAction.mock.calls[0] as any[])[0];
      expect(opts.testMode).toBe(true);
      expect(opts.deleteMessageSeconds).toBe(2 * 3600);
    });

    test('retry reads config from the client-attached manager by default', async () => {
      const row = makeRow({ attempts: 1, action: 'timeout' });
      const { mgr, executeBanAction, client } = makeQueue({ due: [row] });
      const getCachedConfig = jest.fn(async () => ({ enabled: true, testMode: false, timeoutDurationMinutes: 5 }));
      (client as any).baitChannelManager = {
        getCachedConfig,
        inMemberChain: (_g: string, _u: string, t: any) => t(),
        memberBusy: () => false,
      };
      await (mgr as any).tick();
      expect(getCachedConfig).toHaveBeenCalledWith('g1');
      const opts = (executeBanAction.mock.calls[0] as any[])[0];
      expect(opts.testMode).toBe(false);
      expect(opts.timeoutMs).toBe(5 * 60 * 1000);
    });

    test('guild no longer accessible → terminal dead-letter, no executor call', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, executeBanAction } = makeQueue({ due: [row] });
      (mgr as any).deps.client.guilds.fetch = jest.fn(async () => null);
      await (mgr as any).tick();
      expect(executeBanAction).not.toHaveBeenCalled();
      expect(row.deadAt).toBeInstanceOf(Date);
      expect(row.lastError).toContain('guild not accessible');
    });
  });
  describe('a queued action is really retried (#27)', () => {
    test('a ban that failed with a 5xx runs on the retry, for the same post, and the row is done', async () => {
      const idempotencyRepo = makeIdempotencyRepo();
      const guild = {
        id: 'g1',
        bans: {
          create: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
        },
        members: { fetch: jest.fn(async () => null) },
      };
      guild.bans.create.mockImplementationOnce(async () => {
        throw new DiscordAPIError({ message: 'Server Error', code: 0 }, 0, 503, 'PUT', '/bans', {
          body: undefined,
          files: undefined,
        });
      });
      // The first attempt, as the manager makes it.
      const first = await executeBanAction(
        { guild: guild as any, userId: 'u1', action: 'ban', eventId: 'm1', reason: 'r', executorId: 'bot' },
        idempotencyRepo as any,
      );
      expect(first.status).toBe('queued');

      const row = makeRow({ attempts: 1, messageId: 'm1' });
      const removed: any[] = [];
      const logRepo = { update: jest.fn(async () => ({ affected: 1 })) };
      const queue = new RetryQueue({
        client: { user: { id: 'bot' }, guilds: { fetch: jest.fn(async () => guild) } },
        pendingActionRepo: {
          find: jest.fn(async () => [row]),
          findOne: jest.fn(async () => row),
          remove: jest.fn(async (x: any) => removed.push(x)),
          save: jest.fn(async (x: any) => x),
        },
        idempotencyRepo,
        getConfig: async () => null,
        logRepo,
      } as any);
      await (queue as any).tick();

      expect(guild.bans.create).toHaveBeenCalledTimes(2);
      expect(removed).toContain(row);
      expect(logRepo.update).toHaveBeenCalledWith(
        { guildId: 'g1', userId: 'u1', messageId: 'm1', actionTaken: 'queued' },
        { actionTaken: 'ban', failureReason: null, executorId: 'bot' },
      );
    });

    test('the retry claims the post the row is for', async () => {
      const row = makeRow({ attempts: 1, messageId: 'm7' });
      const { mgr, executeBanAction } = makeQueue({ due: [row] });
      await (mgr as any).tick();
      expect((executeBanAction.mock.calls[0] as any[])[0].eventId).toBe('m7');
    });

    test('a softban whose ban landed continues as an unban-only retry', async () => {
      const row = makeRow({ attempts: 1, action: 'softban' });
      const { mgr, saved } = makeQueue({
        due: [row],
        execResult: { status: 'queued', retryAction: 'unban', failureReason: '500' },
      });
      await (mgr as any).tick();
      expect(row.action).toBe('unban');
      expect(saved).toContain(row);
    });

    test('a finished unban is logged as the softban it completes', async () => {
      const row = makeRow({ attempts: 2, action: 'unban' });
      const { mgr, logRepo } = makeQueue({ due: [row], execResult: { status: 'executed' } });
      await (mgr as any).tick();
      expect((logRepo.update.mock.calls[0] as any[])[1].actionTaken).toBe('softban');
    });

    test('a duplicate is logged as superseded, a dead-letter as failed', async () => {
      const dup = makeQueue({ due: [makeRow({ attempts: 1 })], execResult: { status: 'duplicate' } });
      await (dup.mgr as any).tick();
      expect((dup.logRepo.update.mock.calls[0] as any[])[1].actionTaken).toBe('superseded');

      const dead = makeQueue({
        due: [makeRow({ attempts: 1 })],
        execResult: { status: 'failed', failureReason: 'missing perms' },
      });
      await (dead.mgr as any).tick();
      expect((dead.logRepo.update.mock.calls[0] as any[])[1]).toEqual({
        actionTaken: 'failed',
        failureReason: 'missing perms',
        executorId: null,
      });
    });

    test('a retry that is queued again leaves the log row as queued', async () => {
      const { mgr, logRepo } = makeQueue({
        due: [makeRow({ attempts: 1 })],
        execResult: { status: 'queued', failureReason: '429' },
      });
      await (mgr as any).tick();
      expect(logRepo.update).not.toHaveBeenCalled();
    });
  });
  describe('review fixes', () => {
    test('an unban retry in a guild now in test mode still lifts the ban (it undoes our own)', async () => {
      const row = makeRow({ attempts: 1, action: 'unban', messageId: 'm1' });
      const guild = {
        id: 'g1',
        bans: {
          create: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
          fetch: jest.fn(async () => ({ reason: 'Softban — cogworks:bait score=70' })),
        },
        members: { fetch: jest.fn(async () => null) },
      };
      const removed: any[] = [];
      const logRepo = { update: jest.fn(async () => ({ affected: 1 })) };
      const queue = new RetryQueue({
        client: { user: { id: 'bot' }, guilds: { fetch: jest.fn(async () => guild) } },
        pendingActionRepo: {
          find: jest.fn(async () => [row]),
          findOne: jest.fn(async () => row),
          remove: jest.fn(async (x: any) => removed.push(x)),
        },
        idempotencyRepo: makeIdempotencyRepo(),
        getConfig: async () => ({ testMode: true }) as any,
        logRepo,
      } as any);
      await (queue as any).tick();
      expect(guild.bans.remove).toHaveBeenCalledTimes(1);
      expect(removed).toContain(row);
      expect((logRepo.update.mock.calls[0] as any[])[1].actionTaken).toBe('softban');
    });

    test('an unban keeps trying at the 5-minute step; other actions dead-letter at 3 attempts', async () => {
      const unban = makeRow({ attempts: 2, action: 'unban' });
      const q1 = makeQueue({ due: [unban], execResult: { status: 'queued', failureReason: '503' } });
      await (q1.mgr as any).tick();
      expect(unban.attempts).toBe(3);
      expect(unban.deadAt).toBeNull();
      const delta = unban.expiresAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(4 * 60_000);

      const last = makeRow({ attempts: 4, action: 'unban' });
      const q2 = makeQueue({ due: [last], execResult: { status: 'queued', failureReason: '503' } });
      await (q2.mgr as any).tick();
      expect(last.deadAt).toBeInstanceOf(Date);
    });

    test('a retry runs in the manager\'s per-member chain', async () => {
      const row = makeRow({ attempts: 1 });
      const { mgr, client, executeBanAction } = makeQueue({ due: [row] });
      const order: string[] = [];
      (client as any).baitChannelManager = {
        getCachedConfig: jest.fn(async () => null),
        memberBusy: () => false,
        inMemberChain: jest.fn(async (g: string, u: string, task: () => Promise<void>) => {
          order.push(`chain ${g}:${u}`);
          await task();
        }),
      };
      executeBanAction.mockImplementation(async () => {
        order.push('execute');
        return { status: 'executed' };
      });
      await (mgr as any).tick();
      expect(order).toEqual(['chain g1:u1', 'execute']);
    });
  });
  describe('second review', () => {
    test('a row read before it reached the member chain is re-read: gone or changed → nothing runs or is saved', async () => {
      const row = makeRow({ attempts: 1, action: 'softban' });
      const { mgr, pendingActionRepo, executeBanAction } = makeQueue({ due: [row] });
      pendingActionRepo.findOne.mockImplementationOnce(async () => null); // settled meanwhile
      await (mgr as any).tick();
      pendingActionRepo.findOne.mockImplementationOnce(async () => ({ ...row, action: 'unban' })); // rewritten meanwhile
      await (mgr as any).tick();
      expect(executeBanAction).not.toHaveBeenCalled();
      expect(pendingActionRepo.save).not.toHaveBeenCalled();
      expect(pendingActionRepo.remove).not.toHaveBeenCalled();
    });

    test("a member whose chain is busy waits for the next tick; other members' retries run", async () => {
      const busy = makeRow({ id: 1, userId: 'u1', attempts: 1 });
      const free = makeRow({ id: 2, userId: 'u2', attempts: 1 });
      const { mgr, client, executeBanAction } = makeQueue({ due: [busy, free] });
      (client as any).baitChannelManager = {
        getCachedConfig: async () => ({ enabled: true }),
        inMemberChain: (_g: string, _u: string, t: any) => t(),
        memberBusy: (_g: string, u: string) => u === 'u1',
      };
      await (mgr as any).tick();
      expect(executeBanAction.mock.calls.map((c: any[]) => c[0].userId)).toEqual(['u2']);
    });

    test('member gone: a timeout becomes a softban only when the ban list says they are not banned', async () => {
      const banList = { state: 'banned' as 'banned' | 'unreadable' | 'clear' };
      const setup = () => {
        const row = makeRow({ attempts: 1, action: 'timeout' });
        const q = makeQueue({ due: [row], member: null });
        (q.mgr as any).deps.client.guilds.fetch = jest.fn(async () => ({
          id: 'g1',
          members: { fetch: jest.fn(async () => null) },
          bans: {
            fetch: jest.fn(async () => {
              if (banList.state === 'banned') return { reason: 'mod ban' };
              throw new DiscordAPIError({ message: 'x', code: banList.state === 'clear' ? 10026 : 0 }, banList.state === 'clear' ? 10026 : 0, banList.state === 'clear' ? 404 : 503, 'GET', '/bans', { body: undefined, files: undefined });
            }),
          },
        }));
        return { row, ...q };
      };
      const banned = setup();
      await (banned.mgr as any).tick();
      expect(banned.executeBanAction).not.toHaveBeenCalled();
      expect(banned.removed).toContain(banned.row);

      banList.state = 'unreadable';
      const unreadable = setup();
      await (unreadable.mgr as any).tick();
      expect(unreadable.executeBanAction).not.toHaveBeenCalled();
      expect(unreadable.row.attempts).toBe(2); // retried later, not dropped

      banList.state = 'clear';
      const clear = setup();
      await (clear.mgr as any).tick();
      expect((clear.executeBanAction.mock.calls[0] as any[])[0].action).toBe('softban');
    });

    test('bait channel turned off: retries stand down, except an unban', async () => {
      const ban = makeRow({ id: 1, attempts: 1, action: 'ban' });
      const unban = makeRow({ id: 2, attempts: 1, action: 'unban' });
      const { mgr, executeBanAction, removed } = makeQueue({ due: [ban, unban] });
      (mgr as any).deps.getConfig = async () => ({ enabled: false });
      await (mgr as any).tick();
      expect(executeBanAction.mock.calls.map((c: any[]) => c[0].action)).toEqual(['unban']);
      expect(removed).toContain(ban);
    });

    test('an unban that gives up alerts the bait log channel: the user is still banned', async () => {
      const row = makeRow({ attempts: 4, action: 'unban' });
      const { mgr, client } = makeQueue({ due: [row], execResult: { status: 'queued', failureReason: '503' } });
      const send = jest.fn(async () => undefined);
      (mgr as any).deps.getConfig = async () => ({ enabled: true, logChannelId: 'log-1' });
      const guild = {
        id: 'g1',
        members: { fetch: jest.fn(async () => null) },
        channels: { fetch: jest.fn(async () => ({ isTextBased: () => true, send })) },
      };
      (client as any).guilds.fetch = jest.fn(async () => guild);
      await (mgr as any).tick();
      expect(row.deadAt).toBeInstanceOf(Date);
      expect(guild.channels.fetch).toHaveBeenCalledWith('log-1');
      expect((send.mock.calls[0] as any[])[0]).toContain('<@u1>');
    });
  });
});
