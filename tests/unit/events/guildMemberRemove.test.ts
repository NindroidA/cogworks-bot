/**
 * guildMemberRemove leave-drain tests (cogworks-bot#41).
 *
 * Grace-period rows (attempts = 0) belong to BaitChannelManager: the drain
 * must hand the leave to the manager (awaited, guild-scoped) and never run a
 * grace row blind. Retry rows (attempts >= 1) that existed when the member
 * left run through the real RetryQueue.runRow (fresh read, member chain, the
 * tick's rules), so a softban is skipped for a user who is already banned
 * (its unban step would lift that ban).
 *
 * AppDataSource.getRepository is patched per entity; the real RetryQueue and
 * REST executor run against fake repos + guild.bans, so "no action" is
 * asserted at the Discord call.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { DiscordAPIError } from 'discord.js';
import guildMemberRemove from '../../../src/events/guildMemberRemove';
import { AppDataSource } from '../../../src/typeorm';
import { IdempotencyKey } from '../../../src/typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../../../src/typeorm/entities/bait/PendingAction';
import { initRetryQueue, stopRetryQueue } from '../../../src/utils/baitChannel/retryQueue';

const state: { rows: any[]; config: any } = { rows: [], config: null };
const pendingRepo = {
  find: jest.fn(async () => state.rows.map(r => ({ ...r }))),
  findOne: jest.fn(async ({ where }: any) => {
    const r = state.rows.find(x => x.id === where.id && x.guildId === where.guildId);
    return r ? { ...r } : null;
  }),
  remove: jest.fn(async (x: any) => {
    state.rows = state.rows.filter(r => r.id !== x.id);
    return x;
  }),
  save: jest.fn(async (x: any) => {
    state.rows = [...state.rows.filter(r => r.id !== x.id), { ...x }];
    return x;
  }),
};
const idempotencyRepo = {
  create: jest.fn((x: any) => x),
  save: jest.fn(async (x: any) => x),
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  delete: jest.fn(async () => ({ affected: 1 })),
  update: jest.fn(async () => ({ affected: 1 })),
};

let originalGetRepository: ((e: unknown) => unknown) | undefined;

beforeAll(() => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository;
  const repoMap = new Map<unknown, unknown>([
    [PendingAction, pendingRepo],
    [IdempotencyKey, idempotencyRepo],
  ]);
  (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = (e: unknown) =>
    repoMap.get(e) ?? {};
});

afterAll(() => {
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  state.rows = [];
  state.config = { enabled: true, testMode: false, deleteMessageHours: 24 };
  pendingRepo.find.mockClear();
  pendingRepo.remove.mockClear();
  pendingRepo.save.mockClear();
});

afterEach(() => stopRetryQueue());

const unknownBan = () =>
  new DiscordAPIError({ message: 'Unknown Ban', code: 10026 }, 10026, 404, 'GET', '/bans', {
    body: undefined,
    files: undefined,
  });

/** A member who just left, plus the real retry queue wired to the same client. */
function makeMember(manager?: unknown, opts: { banned?: boolean; banListUnreadable?: boolean; banReason?: string } = {}): any {
  const guild: any = {
    id: 'g1',
    members: { fetch: jest.fn(async () => null) }, // gone
    bans: {
      create: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
      fetch: jest.fn(async () => {
        if (opts.banListUnreadable) throw new Error('503 Service Unavailable');
        if (opts.banned) return { user: { id: 'u1' }, reason: opts.banReason ?? null };
        throw unknownBan();
      }),
    },
  };
  const client: any = { user: { id: 'bot' }, baitChannelManager: manager, guilds: { fetch: jest.fn(async () => guild) } };
  initRetryQueue({
    client,
    pendingActionRepo: pendingRepo as any,
    idempotencyRepo: idempotencyRepo as any,
    getConfig: async () => state.config,
  });
  return { id: 'u1', guild, client };
}

const row = (overrides: Record<string, unknown>) => ({
  id: 1,
  guildId: 'g1',
  userId: 'u1',
  messageId: 'm1',
  channelId: 'c1',
  action: 'ban',
  suspicionScore: 60,
  attempts: 0,
  deadAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

/** The manager as the drain and the retry queue see it; resolveGraceOnLeave settles the grace periods. */
const manager = (resolveGraceOnLeave = jest.fn(async () => undefined)) => ({
  resolveGraceOnLeave,
  inMemberChain: jest.fn((_g: string, _u: string, task: () => Promise<unknown>) => task()),
  memberBusy: () => false,
});
const settle = () => manager();

describe('guildMemberRemove bait drain', () => {
  test('hands the leave to the manager for this guild only, and waits for it', async () => {
    const order: string[] = [];
    const resolveGraceOnLeave = jest.fn(async () => {
      await Promise.resolve();
      order.push('manager');
    });
    state.rows = [row({ attempts: 1, action: 'ban' })];
    const member = makeMember(manager(resolveGraceOnLeave));
    member.guild.bans.create = jest.fn(async () => {
      order.push('drain');
    });
    await guildMemberRemove.execute(member);
    expect(resolveGraceOnLeave).toHaveBeenCalledWith('g1', 'u1');
    expect(order).toEqual(['manager', 'drain']);
    expect(member.client.baitChannelManager.inMemberChain).toHaveBeenCalledWith('g1', 'u1', expect.any(Function));
  });

  test('a retry the manager queues during this leave is not run again right away', async () => {
    const resolveGraceOnLeave = jest.fn(async () => {
      // The leave settles a grace period whose softban unban step failed.
      state.rows = [row({ id: 2, attempts: 1, action: 'unban', messageId: 'm2' })];
    });
    const member = makeMember(manager(resolveGraceOnLeave), { banned: true, banReason: 'Softban — x' });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.remove).not.toHaveBeenCalled();
    expect(state.rows).toHaveLength(1);
  });

  test('never runs a grace row (attempts = 0), even one left behind', async () => {
    state.rows = [row({ attempts: 0, action: 'ban' })];
    const member = makeMember(settle());
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(pendingRepo.remove).not.toHaveBeenCalled();
  });

  test('still drains retry rows (attempts >= 1), with the configured delete window', async () => {
    state.rows = [row({ attempts: 1, action: 'ban' })];
    state.config.deleteMessageHours = 2;
    const member = makeMember(settle());
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).toHaveBeenCalledTimes(1);
    expect((member.guild.bans.create.mock.calls[0] as any[])[1].deleteMessageSeconds).toBe(2 * 3600);
    expect(state.rows).toHaveLength(0);
  });

  test('a retry row demoted to softban runs when the user left unbanned', async () => {
    state.rows = [row({ attempts: 1, action: 'timeout' })];
    const member = makeMember(settle());
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).toHaveBeenCalledTimes(1);
    expect(member.guild.bans.remove).toHaveBeenCalledTimes(1);
  });

  test('never softbans a user who left banned, so a mod’s ban is not lifted', async () => {
    state.rows = [row({ attempts: 1, action: 'timeout' })];
    const member = makeMember(settle(), { banned: true });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(member.guild.bans.remove).not.toHaveBeenCalled();
    expect(state.rows).toHaveLength(0);
  });

  test('never softbans when the ban list cannot be read; the row is retried later', async () => {
    state.rows = [row({ attempts: 1, action: 'kick' })];
    const member = makeMember(settle(), { banListUnreadable: true });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(member.guild.bans.remove).not.toHaveBeenCalled();
    expect(state.rows[0].attempts).toBe(2);
  });

  test('test mode: a retry row is a dry run, but an unban still lifts our own ban', async () => {
    state.rows = [row({ attempts: 1, action: 'ban' }), row({ id: 2, attempts: 1, action: 'unban', messageId: 'm2' })];
    state.config.testMode = true;
    const member = makeMember(settle(), { banned: true, banReason: 'Softban — x' });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(member.guild.bans.remove).toHaveBeenCalledTimes(1);
  });

  test('bait channel turned off: retry rows stand down, except an unban', async () => {
    state.rows = [row({ attempts: 1, action: 'ban' }), row({ id: 2, attempts: 1, action: 'unban', messageId: 'm2' })];
    state.config.enabled = false;
    const member = makeMember(settle(), { banned: true, banReason: 'Softban — x' });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(member.guild.bans.remove).toHaveBeenCalledTimes(1);
    expect(state.rows).toHaveLength(0);
  });

  test('a softban whose unban fails on leave continues as an unban-only retry', async () => {
    state.rows = [row({ attempts: 1, action: 'softban', messageId: 'm9' })];
    const member = makeMember(settle());
    member.guild.bans.remove = jest.fn(async () => {
      throw new Error('socket hang up');
    });
    await guildMemberRemove.execute(member);
    expect((idempotencyRepo.save.mock.calls.at(-1) as any[])[0].action).toBe('softban:m9');
    expect(member.guild.bans.create).toHaveBeenCalledTimes(1);
    expect(state.rows[0]).toMatchObject({ action: 'unban', attempts: 2 });
  });
});
