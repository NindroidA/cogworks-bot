/**
 * memoryHandlers API tests (v3.16.16, audit 68).
 *
 * POST /memory/create posts the description as the forum thread's starter
 * message (2000-char limit) and the title as the thread name (100-char limit).
 * Both used to reach threads.create unchecked, so long dashboard creates came
 * back as a 500. Now an over-long title is a 400 before anything runs, and the
 * description is clamped with a visible notice.
 *
 * Same AppDataSource.getRepository runtime patch as ticketHandlers.test.ts.
 * No `triggeredBy` in the body, so writeAuditAction returns without a DB write.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Client } from 'discord.js';

type Row = Record<string, unknown>;

const config = { id: 7, guildId: 'g-api', forumChannelId: 'forum-api' };
const openTag = {
  id: 70,
  guildId: 'g-api',
  memoryConfigId: 7,
  name: 'Open',
  tagType: 'status',
  discordTagId: 'd-open',
};
const savedItems: Row[] = [];

const fakeRepos: Record<string, unknown> = {
  MemoryConfig: { findOneBy: async () => config },
  MemoryTag: { findOneBy: async () => null, findOne: async () => openTag },
  MemoryItem: {
    create: (row: Row) => ({ ...row }),
    save: async (row: Row) => {
      row.id = 1;
      savedItems.push(row);
      return row;
    },
  },
};

let routes: Map<string, (guildId: string, body: Row) => Promise<unknown>>;
let created: Array<{ name: string; message: { content: string }; appliedTags: string[] }>;
let originalGetRepository: ((entity: unknown) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: (e: unknown) => unknown };
  originalGetRepository = ds.getRepository;
  ds.getRepository = (entity: unknown) => {
    const repo = fakeRepos[(entity as { name?: string })?.name ?? ''];
    if (!repo) throw new Error(`Unmocked entity: ${(entity as { name?: string })?.name}`);
    return repo;
  };
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(async () => {
  savedItems.length = 0;
  created = [];
  const forum = {
    id: 'forum-api',
    threads: {
      create: async (opts: (typeof created)[number]) => {
        if (opts.name.length > 100) throw new Error('50035: name too long');
        if (opts.message.content.length > 2000) throw new Error('50035: content too long');
        created.push(opts);
        return { id: 'thread-api' };
      },
    },
  };
  const client = {
    guilds: { cache: { get: () => ({ channels: { fetch: async () => forum } }) } },
  } as unknown as Client;
  const { registerMemoryHandlers } = await import('../../../../src/utils/api/handlers/memoryHandlers');
  routes = new Map();
  registerMemoryHandlers(client, routes as never);
});

const create = (body: Row) =>
  routes.get('POST /memory/create')!('g-api', { memoryConfigId: 7, createdBy: 'u-1', ...body });

describe('POST /memory/create limits (audit 68)', () => {
  test('a title over 100 characters is a 400 and creates nothing', async () => {
    await expect(create({ title: 't'.repeat(101) })).rejects.toMatchObject({ statusCode: 400 });
    expect(created).toHaveLength(0);
    expect(savedItems).toHaveLength(0);
  });

  test('a 100-character title is accepted', async () => {
    await create({ title: 't'.repeat(100) });
    expect(created[0].name).toHaveLength(100);
  });

  test('a long description is clamped to the 2000-char starter message with a notice', async () => {
    const description = 'd'.repeat(5000);
    const result = await create({ title: 'Long one', description });

    expect(result).toEqual({ success: true, threadId: 'thread-api', itemId: 1 });
    const content = created[0].message.content;
    expect(content.length).toBe(2000);
    expect(content).toContain('(content truncated)');
    expect(content.endsWith('-# Created via dashboard')).toBe(true);
    expect(created[0].appliedTags).toEqual(['d-open']);
    // The full text is still stored on the item
    expect(savedItems[0].description).toBe(description);
  });

  test('no description: just the footer', async () => {
    await create({ title: 'Short' });
    expect(created[0].message.content).toBe('-# Created via dashboard');
  });
});
