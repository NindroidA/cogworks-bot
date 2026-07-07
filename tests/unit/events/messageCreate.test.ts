/**
 * messageCreate Event Handler Unit Tests (v3.16.0)
 *
 * Pins the SLA first-response capture: before v3.16.0 NOTHING in production
 * wrote Ticket.firstResponseAt (dev seeding only), so slaChecker's
 * `firstResponseAt IS NULL` query matched every ticket forever. The handler
 * now issues ONE UPDATE per guild message that bumps lastActivityAt and — via
 * a conditional CASE — captures firstResponseAt for the first non-opener
 * response. These tests assert the merged statement's SET/WHERE shape, the
 * email-import exemption (createdBy is the importing admin there, so the
 * opener-exclusion is skipped), and that bot/DM messages never reach it.
 *
 * Strategy: patch AppDataSource.getRepository (same seam as
 * channelDelete.test.ts) with a fake exposing a recording query-builder.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';

interface RecordedUpdate {
  set: Record<string, unknown>;
  wheres: { clause: string; params?: Record<string, unknown> }[];
  params: Record<string, unknown>;
}

const executedUpdates: RecordedUpdate[] = [];

function makeQueryBuilder() {
  const record: RecordedUpdate = { set: {}, wheres: [], params: {} };
  const qb: any = {
    update: () => qb,
    set: (values: Record<string, unknown>) => {
      record.set = values;
      return qb;
    },
    where: (clause: string, params?: Record<string, unknown>) => {
      record.wheres.push({ clause, params });
      if (params) Object.assign(record.params, params);
      return qb;
    },
    andWhere: (clause: string, params?: Record<string, unknown>) => {
      record.wheres.push({ clause, params });
      if (params) Object.assign(record.params, params);
      return qb;
    },
    setParameters: (params: Record<string, unknown>) => {
      Object.assign(record.params, params);
      return qb;
    },
    setParameter: (key: string, value: unknown) => {
      record.params[key] = value;
      return qb;
    },
    execute: async () => {
      executedUpdates.push(record);
      return { affected: 0 };
    },
  };
  return qb;
}

const fakeTicketRepo = { createQueryBuilder: () => makeQueryBuilder() };

let messageCreateHandler: typeof import('../../../src/events/messageCreate').default;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../src/typeorm');
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = () => fakeTicketRepo;
  messageCreateHandler = (await import('../../../src/events/messageCreate')).default;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

const mockClient = {
  baitChannelManager: {
    trackMessage: jest.fn(async () => {}),
    handleMessage: jest.fn(async () => {}),
  },
} as any;

function makeMessage(overrides: Partial<any> = {}) {
  return {
    guild: { id: 'guild-1' },
    channelId: 'chan-1',
    channel: { name: 'general' },
    author: { id: 'author-1', bot: false },
    ...overrides,
  } as any;
}

/** The raw SQL of the firstResponseAt CASE expression (set() takes a fn). */
function firstResponseSql(update: RecordedUpdate): string {
  const fn = update.set.firstResponseAt as () => string;
  return fn();
}

describe('messageCreate ticket updates', () => {
  beforeEach(() => {
    executedUpdates.length = 0;
    mockClient.baitChannelManager.trackMessage.mockClear();
    mockClient.baitChannelManager.handleMessage.mockClear();
  });

  test('guild message fires ONE merged UPDATE setting both lastActivityAt and firstResponseAt', async () => {
    await messageCreateHandler.execute(makeMessage(), mockClient);

    expect(executedUpdates).toHaveLength(1);
    expect(Object.keys(executedUpdates[0].set).sort()).toEqual(['firstResponseAt', 'lastActivityAt']);
    // lastActivityAt is an unconditional Date; firstResponseAt is a CASE fn.
    expect(executedUpdates[0].set.lastActivityAt).toBeInstanceOf(Date);
    expect(typeof executedUpdates[0].set.firstResponseAt).toBe('function');
  });

  test('firstResponseAt CASE carries the guard trio and the email-import exemption', async () => {
    await messageCreateHandler.execute(makeMessage(), mockClient);

    const sql = firstResponseSql(executedUpdates[0]);
    expect(sql).toContain('firstResponseAt IS NULL');
    expect(sql).toContain('createdBy != :author');
    // Email-import tickets: createdBy is the importing admin, so every Discord
    // message is a staff response — the opener-exclusion must be OR-skipped.
    expect(sql).toContain('isEmailTicket = TRUE');
    // author param bound to the message author (the DB comparison excludes the opener)
    expect(executedUpdates[0].params.author).toBe('author-1');
    // firstResponseNow bound and equal to the lastActivityAt value (one clock read)
    expect(executedUpdates[0].params.firstResponseNow).toBe(executedUpdates[0].set.lastActivityAt);
  });

  test('UPDATE is guild-scoped and skips closed tickets', async () => {
    await messageCreateHandler.execute(makeMessage(), mockClient);

    const clauses = executedUpdates[0].wheres.map(w => w.clause);
    expect(clauses.some(c => c.includes('guildId'))).toBe(true);
    expect(clauses.some(c => c.includes('channelId'))).toBe(true);
    expect(clauses.some(c => c.includes('status != :closed'))).toBe(true);
    const guildWhere = executedUpdates[0].wheres.find(w => w.clause.includes('guildId'));
    expect(guildWhere?.params).toEqual({ guildId: 'guild-1' });
  });

  test('bot messages never reach the ticket update', async () => {
    await messageCreateHandler.execute(makeMessage({ author: { id: 'bot-1', bot: true } }), mockClient);
    expect(executedUpdates).toHaveLength(0);
  });

  test('DM messages (no guild) never reach the ticket update', async () => {
    await messageCreateHandler.execute(makeMessage({ guild: null }), mockClient);
    expect(executedUpdates).toHaveLength(0);
  });
});
