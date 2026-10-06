/**
 * /archive cleanup export + delete (v3.16.10 regression).
 *
 * Before: the export held only row metadata, then every forum thread (the only
 * copy of each transcript) was deleted, along with rows created after the
 * export and rows whose thread failed to delete. Now the export carries the
 * transcript text, and deletion covers exactly the exported rows whose
 * transcript is in the file and whose thread is confirmed gone. A returning
 * user's re-close appends to their existing archive thread, so a thread that
 * changed after the export (or a row repointed to a new thread) is kept.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import { version } from '../../../../package.json';
import { deleteArchivedEntries, exportArchives } from '../../../../src/utils/archive/archiveExporter';
import { apiError, type FakeRepo, GUILD, makeChannel, makeClient, makeRepo, patchRepositories } from './fakeDiscord';

let tickets: FakeRepo;
let apps: FakeRepo;
const restore = await patchRepositories(() => ({ ArchivedTicket: tickets, ArchivedApplication: apps }));
afterAll(restore);

beforeEach(() => {
  tickets = makeRepo([
    { id: 1, guildId: GUILD, messageId: 'th-1', createdBy: 'u1' },
    { id: 2, guildId: GUILD, messageId: 'th-denied', createdBy: 'u2' },
    { id: 3, guildId: GUILD, messageId: null, createdBy: 'u3' },
    { id: 4, guildId: '999', messageId: 'th-other-guild', createdBy: 'u4' },
  ]);
  apps = makeRepo([{ id: 10, guildId: GUILD, messageId: 'th-gone', createdBy: 'u5' }]);
});

describe('exportArchives', () => {
  test('embeds each thread transcript and only marks rows covered by the file as deletable', async () => {
    const client = makeClient({ 'th-1': makeChannel('th-1', ['Need help', 'Fixed!']), 'th-denied': apiError(50001) });
    const result = await exportArchives(GUILD, 'all', client);

    const archive = JSON.parse(gunzipSync(result.buffer).toString());
    expect(archive.format).toBe('cogworks-archive-v2');
    expect(archive.metadata.version).toBe(version); // the dashboard's Archive Viewer shows it
    expect(archive.archivedTickets.map((t: { id: number }) => t.id)).toEqual([1, 2, 3]);
    expect(archive.transcripts['th-1'].messages.map((m: { content: string }) => m.content)).toEqual([
      'Need help',
      'Fixed!',
    ]);
    expect(archive.metadata.unreadableThreadIds).toEqual(['th-denied']);

    expect(result.entryCount).toBe(4);
    // Row 2's thread couldn't be read: it is neither in the file nor deletable.
    expect(result.deletable.tickets.map(r => r.id)).toEqual([1, 3]);
    expect(result.deletable.applications.map(r => r.id)).toEqual([10]);
    expect(result.unreadableCount).toBe(1);
  });
});

/** Export rows 1 (th-1) and 10 (th-gone), as the handler would before its prompt. */
async function exportTicketsAndApps(client: any) {
  tickets.rows = tickets.rows.filter(r => r.id === 1);
  return (await exportArchives(GUILD, 'all', client)).deletable;
}

describe('deleteArchivedEntries', () => {
  test('deletes thread then row, keeps rows whose thread survived, never touches unlisted rows', async () => {
    const t1 = makeChannel('th-1', ['Need help']);
    const locked = makeChannel('th-locked', ['Locked'], { deleteError: 50013 });
    const client = makeClient({
      'th-1': t1,
      'th-gone': apiError(10003),
      'th-locked': locked,
      'th-denied': apiError(50001),
    });
    tickets.rows.push({ id: 6, guildId: GUILD, messageId: 'th-locked' });
    const exported = (await exportArchives(GUILD, 'all', client)).deletable;
    tickets.rows.push({ id: 5, guildId: GUILD, messageId: 'th-new' }); // archived after the export ran

    const result = await deleteArchivedEntries(GUILD, exported, client);

    expect(t1.deleted).toBe(true);
    expect(result).toEqual({ deleted: 3, threadsDeleted: 1, kept: 1 });
    expect(tickets.rows.map(r => r.id).sort()).toEqual([2, 4, 5, 6]);
    expect(apps.rows).toEqual([]);
  });

  test("keeps a returning user's thread that got a new transcript after the export, and its row", async () => {
    const t1 = makeChannel('th-1', ['First ticket transcript']);
    const client = makeClient({ 'th-1': t1 });
    const exported = await exportTicketsAndApps(client);
    t1.post('Second ticket transcript'); // u1's new ticket closed while the prompt was open

    const result = await deleteArchivedEntries(GUILD, exported, client);

    expect(t1.deleted).toBe(false);
    expect(tickets.rows.map(r => r.id)).toEqual([1]);
    expect(result).toEqual({ deleted: 1, threadsDeleted: 0, kept: 1 }); // only row 10 (thread already gone)
  });

  test('keeps a row repointed to a thread the export never read', async () => {
    const recreated = makeChannel('th-recreated', ['Re-created after the export']);
    const client = makeClient({ 'th-1': makeChannel('th-1', ['Old']), 'th-recreated': recreated });
    const exported = await exportTicketsAndApps(client);
    apps.rows[0].messageId = 'th-recreated'; // a close re-created the missing thread and repointed the row

    const result = await deleteArchivedEntries(GUILD, exported, client);

    expect(recreated.deleted).toBe(false);
    expect(apps.rows.map(r => r.id)).toEqual([10]);
    expect(result).toEqual({ deleted: 1, threadsDeleted: 1, kept: 1 });
  });

  test('keeps a row a close repointed to a new thread while the cleanup was running', async () => {
    const t1 = makeChannel('th-1', ['Old']);
    const client = makeClient({ 'th-1': t1 });
    const exported = await exportTicketsAndApps(client);
    const deleteThread = t1.delete;
    t1.delete = async () => {
      await deleteThread();
      tickets.rows[0].messageId = 'th-recreated'; // u1's next close found th-1 gone and re-created it
    };

    const result = await deleteArchivedEntries(GUILD, exported, client);

    expect(t1.deleted).toBe(true);
    expect(tickets.rows).toMatchObject([{ id: 1, messageId: 'th-recreated' }]);
    expect(result).toEqual({ deleted: 1, threadsDeleted: 1, kept: 1 }); // only row 10 (thread already gone)
  });
});
