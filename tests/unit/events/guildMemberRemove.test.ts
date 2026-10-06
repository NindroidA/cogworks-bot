/**
 * guildMemberRemove leave-drain tests (cogworks-bot#41).
 *
 * Grace-period rows (attempts = 0) belong to BaitChannelManager: the drain
 * must hand the leave to the manager (awaited, guild-scoped) and never run a
 * grace row blind. Retry rows (attempts >= 1) still drain as before, except
 * that a softban is skipped for a user who is already banned (its unban step
 * would lift that ban).
 *
 * AppDataSource.getRepository is patched per entity; the real REST executor
 * runs against a fake idempotency repo + guild.bans, so "no action" is
 * asserted at the Discord call.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { DiscordAPIError } from 'discord.js';
import guildMemberRemove from '../../../src/events/guildMemberRemove';
import { AppDataSource } from '../../../src/typeorm';
import { IdempotencyKey } from '../../../src/typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../../../src/typeorm/entities/bait/PendingAction';

const state: { rows: any[] } = { rows: [] };
const pendingRepo = {
  find: jest.fn(async () => state.rows),
  remove: jest.fn(async (x: any) => x),
};
const idempotencyRepo = {
  create: jest.fn((x: any) => x),
  save: jest.fn(async (x: any) => x),
  findOne: jest.fn(async () => null),
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
  pendingRepo.find.mockClear();
  pendingRepo.remove.mockClear();
});

function makeMember(manager?: unknown, opts: { banned?: boolean; banListUnreadable?: boolean } = {}): any {
  return {
    id: 'u1',
    guild: {
      id: 'g1',
      bans: {
        create: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
        fetch: jest.fn(async () => {
          if (opts.banListUnreadable) throw new Error('503 Service Unavailable');
          if (opts.banned) return { user: { id: 'u1' } };
          throw new DiscordAPIError({ message: 'Unknown Ban', code: 10026 }, 10026, 404, 'GET', '/bans', {
            body: undefined,
            files: undefined,
          });
        }),
      },
    },
    client: { user: { id: 'bot' }, baitChannelManager: manager },
  };
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
  ...overrides,
});

describe('guildMemberRemove bait drain', () => {
  test('hands the leave to the manager for this guild only, and waits for it', async () => {
    const order: string[] = [];
    const resolveGraceOnLeave = jest.fn(async () => {
      await Promise.resolve();
      order.push('manager');
    });
    pendingRepo.find.mockImplementationOnce(async () => {
      order.push('drain');
      return [];
    });
    await guildMemberRemove.execute(makeMember({ resolveGraceOnLeave }));
    expect(resolveGraceOnLeave).toHaveBeenCalledWith('g1', 'u1');
    expect(order).toEqual(['manager', 'drain']);
  });

  test('never runs a grace row (attempts = 0), even one left behind', async () => {
    state.rows = [row({ attempts: 0, action: 'ban' })];
    const member = makeMember({ resolveGraceOnLeave: jest.fn(async () => undefined) });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(pendingRepo.remove).not.toHaveBeenCalled();
  });

  test('still drains retry rows (attempts >= 1)', async () => {
    state.rows = [row({ attempts: 1, action: 'ban' })];
    const member = makeMember({ resolveGraceOnLeave: jest.fn(async () => undefined) });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).toHaveBeenCalledTimes(1);
    expect(pendingRepo.remove).toHaveBeenCalledTimes(1);
  });

  test('a retry row demoted to softban runs when the user left unbanned', async () => {
    state.rows = [row({ attempts: 1, action: 'timeout' })];
    const member = makeMember({ resolveGraceOnLeave: jest.fn(async () => undefined) });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).toHaveBeenCalledTimes(1);
    expect(member.guild.bans.remove).toHaveBeenCalledTimes(1);
  });

  test('never softbans a user who left banned, so a mod’s ban is not lifted', async () => {
    state.rows = [row({ attempts: 1, action: 'timeout' })];
    const member = makeMember({ resolveGraceOnLeave: jest.fn(async () => undefined) }, { banned: true });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(member.guild.bans.remove).not.toHaveBeenCalled();
    expect(pendingRepo.remove).toHaveBeenCalledTimes(1);
  });

  test('never softbans when the ban list cannot be read (the user may be banned)', async () => {
    state.rows = [row({ attempts: 1, action: 'kick' })];
    const member = makeMember({ resolveGraceOnLeave: jest.fn(async () => undefined) }, { banListUnreadable: true });
    await guildMemberRemove.execute(member);
    expect(member.guild.bans.create).not.toHaveBeenCalled();
    expect(member.guild.bans.remove).not.toHaveBeenCalled();
    expect(pendingRepo.remove).toHaveBeenCalledTimes(1);
  });
});
