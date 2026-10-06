/**
 * /archive cleanup Handler Unit Tests (v3.16.10 regressions)
 *
 * Before: a failed DM still offered "Yes, Delete Archives" (deleting the only
 * copy), the 24h limit was spent even when there was nothing to export, and
 * "Yes" deleted every row but left the forum threads it never exported. A DB
 * error during "Yes" left the reply stuck on "Deleting archived entries...".
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { archiveCleanupHandler } from '../../../src/commands/handlers/archive/cleanup';
import { createRateLimitKey, rateLimiter } from '../../../src/utils/security/rateLimiter';
import { type FakeRepo, makeChannel, makeClient, makeRepo, patchRepositories } from '../utils/archive/fakeDiscord';

const GUILD = '400000000000000001';
const LIMIT_KEY = createRateLimitKey.guild(GUILD, 'archive-cleanup');

let tickets: FakeRepo;
const restore = await patchRepositories(() => ({ ArchivedTicket: tickets }));
afterAll(restore);

const originalRelease = process.env.RELEASE;
beforeEach(() => {
  process.env.RELEASE = 'prod';
  rateLimiter.destroy();
  tickets = makeRepo([{ id: 1, guildId: GUILD, messageId: 'th-1', createdBy: 'u1' }]);
});
afterEach(() => {
  rateLimiter.reset(LIMIT_KEY);
  process.env.RELEASE = originalRelease;
  rateLimiter.destroy();
});

/** A button collector the test drives by emitting 'collect'. */
const makeCollector = () => Object.assign(new EventEmitter(), { stop: () => {} });

function makeInteraction(opts: { dmFails?: boolean; collector?: EventEmitter } = {}) {
  const calls = { edits: [] as any[], dms: [] as any[] };
  const interaction = {
    guildId: GUILD,
    guild: { name: 'Test Guild' },
    commandName: 'archive',
    member: { permissions: { has: () => true } },
    options: { getString: () => 'tickets' },
    user: {
      id: 'admin-1',
      tag: 'admin#0001',
      send: async (o: unknown) => {
        if (opts.dmFails) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
        calls.dms.push(o);
      },
    },
    isRepliable: () => true,
    deferReply: async () => {},
    reply: async () => {},
    editReply: async (o: unknown) => {
      calls.edits.push(o);
      return { createMessageComponentCollector: () => opts.collector };
    },
  };
  return { interaction: interaction as any, calls };
}

describe('/archive cleanup', () => {
  test('a failed DM offers no deletion and gives the daily export back', async () => {
    const { interaction, calls } = makeInteraction({ dmFails: true });
    const thread = makeChannel('th-1', ['transcript line']);
    await archiveCleanupHandler(makeClient({ 'th-1': thread }), interaction);

    const last = calls.edits.at(-1);
    expect(last.embeds[0].data.title).toBe('Archive Not Delivered');
    expect(last.components).toBeUndefined();
    expect(thread.deleted).toBe(false);
    expect(tickets.rows).toHaveLength(1);
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });

  test('"Yes" deletes exported threads and their rows, keeping a thread that changed since', async () => {
    tickets.rows.push({ id: 2, guildId: GUILD, messageId: 'th-2', createdBy: 'u2' });
    const t1 = makeChannel('th-1', ['first ticket'], { guildId: GUILD });
    const t2 = makeChannel('th-2', ['returning user, first ticket'], { guildId: GUILD });
    const collector = makeCollector();
    const { interaction, calls } = makeInteraction({ collector });
    await archiveCleanupHandler(makeClient({ 'th-1': t1, 'th-2': t2 }), interaction);
    expect(calls.edits.at(-1).embeds[0].data.title).toBe('Archive Exported');

    t2.post('returning user, second ticket'); // their next ticket closed while the prompt was up
    const summary = await new Promise<any>(resolve => {
      collector.emit('collect', { customId: 'archive_delete_yes', update: async () => {}, editReply: resolve });
    });

    expect(t1.deleted).toBe(true);
    expect(t2.deleted).toBe(false);
    expect(tickets.rows.map(r => r.id)).toEqual([2]);
    const fields = summary.embeds[0].data.fields.map((f: { value: string }) => f.value);
    expect(fields.slice(0, 2)).toEqual(['2 entries', '1 records, 1 threads']);
    expect(fields[2]).toStartWith('1 ');
  });

  test('a DB error part-way through "Yes" reports what was deleted before it', async () => {
    tickets.rows.push({ id: 2, guildId: GUILD, messageId: 'th-2', createdBy: 'u2' });
    const realDelete = tickets.delete;
    let deletes = 0;
    tickets.delete = async where => {
      if (++deletes === 2) throw new Error('ER_LOCK_WAIT_TIMEOUT');
      return realDelete(where);
    };
    const client = makeClient({
      'th-1': makeChannel('th-1', ['one'], { guildId: GUILD }),
      'th-2': makeChannel('th-2', ['two'], { guildId: GUILD }),
    });
    const collector = makeCollector();
    const { interaction } = makeInteraction({ collector });
    await archiveCleanupHandler(client, interaction);

    const reply = await new Promise<any>(resolve => {
      const editReply = async (o: unknown) => resolve(o);
      collector.emit('collect', { customId: 'archive_delete_yes', update: async () => {}, editReply });
    });

    expect(reply.content).toContain('stopped after an error');
    expect(reply.content).toContain('1 records and 2 threads were deleted');
    expect(tickets.rows.map(r => r.id)).toEqual([2]);
  });

  test('nothing to export gives the daily export back', async () => {
    tickets = makeRepo([]);
    const { interaction, calls } = makeInteraction();
    await archiveCleanupHandler(makeClient({}), interaction);

    expect(calls.edits.at(-1).content).toContain('No archived tickets');
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });
});
