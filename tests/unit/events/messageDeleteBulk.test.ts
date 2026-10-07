/**
 * messageDeleteBulk (NindroidA/cogworks-bot#41, audit 121).
 *
 * A purge arrives as one bulk event, so the per-message config cleanup must
 * run from it: a purged panel message no longer stays referenced. Cached
 * messages the bot didn't write are skipped before any query, and a purge
 * never touches pending bait grace bans.
 *
 * Strategy: patch AppDataSource.getRepository with one shared fake per
 * entity (the same seam as messageDelete.test.ts).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { Collection } from 'discord.js';
import { type FakeRepo, makeFakeRepo } from '../../helpers/fakeRepo';

const ENTITIES = [
  'TicketConfig',
  'ArchivedTicketConfig',
  'ApplicationConfig',
  'ArchivedApplicationConfig',
  'BaitChannelConfig',
  'RulesConfig',
  'ReactionRoleMenu',
  'MemoryConfig',
];
const fakeRepos: Record<string, FakeRepo> = Object.fromEntries(ENTITIES.map(name => [name, makeFakeRepo()]));

let bulkHandler: typeof import('../../../src/events/messageDeleteBulk').default;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: (e: any) => unknown };
  originalGetRepository = ds.getRepository;
  ds.getRepository = (entity: any) => {
    const repo = fakeRepos[entity?.name];
    if (!repo) throw new Error(`messageDeleteBulk test: no fake repo for "${entity?.name}"`);
    return repo;
  };
  bulkHandler = (await import('../../../src/events/messageDeleteBulk')).default;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  for (const repo of Object.values(fakeRepos)) {
    repo.rows.clear();
    for (const list of Object.values(repo.calls)) list.length = 0;
  }
});

const handleMessageDelete = jest.fn(async () => {});
const client: any = { user: { id: 'bot-id' }, baitChannelManager: { handleMessageDelete } };

const message = (id: string, authorId: string | null) => ({
  id,
  guild: { id: 'guild-1' },
  author: authorId ? { id: authorId } : null,
});

describe('messageDeleteBulk (audit 121)', () => {
  test('clears a config reference to a purged message without touching bait grace bans', async () => {
    fakeRepos.TicketConfig.rows.set('1', { id: 1, guildId: 'guild-1', messageId: 'panel', channelId: 'tickets' });
    const messages = new Collection<string, any>([
      ['chat-1', message('chat-1', 'member-1')],
      ['panel', message('panel', null)], // uncached partial: author unknown
    ]);

    await bulkHandler.execute(messages, client);

    expect(fakeRepos.TicketConfig.rows.get('1').messageId).toBe('');
    // A moderator purge must not cancel pending grace bans (only the user deleting their own post does)
    expect(handleMessageDelete).not.toHaveBeenCalled();
  });

  test('cached messages from other users cost no queries', async () => {
    handleMessageDelete.mockClear();
    const messages = new Collection<string, any>([
      ['chat-1', message('chat-1', 'member-1')],
      ['chat-2', message('chat-2', 'member-2')],
    ]);

    await bulkHandler.execute(messages, client);

    const queries = Object.values(fakeRepos).reduce(
      (n, repo) => n + repo.findOneByCalls.length + repo.findCalls.length,
      0,
    );
    expect(queries).toBe(0);
    expect(handleMessageDelete).not.toHaveBeenCalled();
  });
});
