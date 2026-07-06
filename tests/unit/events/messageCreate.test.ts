/**
 * messageCreate Event Handler Unit Tests (v3.16.0)
 *
 * Pins the SLA first-response capture: before v3.16.0 NOTHING in production
 * wrote Ticket.firstResponseAt (dev seeding only), so slaChecker's
 * `firstResponseAt IS NULL` query matched every ticket forever. The handler
 * now issues a second conditional UPDATE per guild message; these tests
 * assert its WHERE clause carries the guard trio (open ticket, first
 * response still null, author is not the opener) and that bot/DM messages
 * never reach it.
 *
 * Strategy: patch AppDataSource.getRepository (same seam as
 * channelDelete.test.ts) with a fake exposing a recording query-builder.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';

interface RecordedUpdate {
  set: Record<string, unknown>;
  wheres: { clause: string; params?: Record<string, unknown> }[];
}

const executedUpdates: RecordedUpdate[] = [];

function makeQueryBuilder() {
  const record: RecordedUpdate = { set: {}, wheres: [] };
  const qb: any = {
    update: () => qb,
    set: (values: Record<string, unknown>) => {
      record.set = values;
      return qb;
    },
    where: (clause: string, params?: Record<string, unknown>) => {
      record.wheres.push({ clause, params });
      return qb;
    },
    andWhere: (clause: string, params?: Record<string, unknown>) => {
      record.wheres.push({ clause, params });
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

describe('messageCreate ticket updates', () => {
  beforeEach(() => {
    executedUpdates.length = 0;
    mockClient.baitChannelManager.trackMessage.mockClear();
    mockClient.baitChannelManager.handleMessage.mockClear();
  });

  test('guild message fires BOTH updates: lastActivityAt bump + firstResponseAt capture', async () => {
    await messageCreateHandler.execute(makeMessage(), mockClient);

    expect(executedUpdates).toHaveLength(2);
    expect(Object.keys(executedUpdates[0].set)).toEqual(['lastActivityAt']);
    expect(Object.keys(executedUpdates[1].set)).toEqual(['firstResponseAt']);
  });

  test('firstResponseAt update carries the guard trio: open, still-null, not-the-opener', async () => {
    await messageCreateHandler.execute(makeMessage(), mockClient);

    const clauses = executedUpdates[1].wheres.map(w => w.clause);
    expect(clauses).toContain('firstResponseAt IS NULL');
    expect(clauses.some(c => c.includes('createdBy != :author'))).toBe(true);
    expect(clauses.some(c => c.includes('status != :closed'))).toBe(true);
    // Guild-scoped (multi-server isolation)
    const guildWhere = executedUpdates[1].wheres.find(w => w.clause.includes('guildId'));
    expect(guildWhere?.params).toEqual({ guildId: 'guild-1' });
    // The author param is the message author — the DB comparison excludes the opener
    const authorWhere = executedUpdates[1].wheres.find(w => w.clause.includes(':author'));
    expect(authorWhere?.params).toEqual({ author: 'author-1' });
  });

  test('bot messages never reach the ticket updates', async () => {
    await messageCreateHandler.execute(makeMessage({ author: { id: 'bot-1', bot: true } }), mockClient);
    expect(executedUpdates).toHaveLength(0);
  });

  test('DM messages (no guild) never reach the ticket updates', async () => {
    await messageCreateHandler.execute(makeMessage({ guild: null }), mockClient);
    expect(executedUpdates).toHaveLength(0);
  });
});
