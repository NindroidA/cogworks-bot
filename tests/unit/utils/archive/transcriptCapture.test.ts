/**
 * transcriptCapture: the read-before-delete step for /bot-reset and
 * /archive cleanup (v3.16.10). Transcripts live only in Discord threads, so a
 * thread whose text can't be read must be reported as unreadable (and then
 * kept by the caller), never silently treated as "nothing to save".
 */

import { describe, expect, test } from 'bun:test';
import {
  captureTranscripts,
  deleteChannelById,
  deleteIfExported,
  exportCoverage,
} from '../../../../src/utils/archive/transcriptCapture';
import { apiError, GUILD, makeChannel, makeClient } from './fakeDiscord';

describe('captureTranscripts', () => {
  test('reads every message of each channel, oldest first', async () => {
    const client = makeClient({ t1: makeChannel('t1', ['hello', 'second']), t2: makeChannel('t2', ['other']) });
    const result = await captureTranscripts(client, GUILD, ['t1', 't2']);

    expect(Object.keys(result.transcripts)).toEqual(['t1', 't2']);
    expect(result.transcripts.t1.messages.map(m => m.content)).toEqual(['hello', 'second']);
    expect(result.transcripts.t1.lastMessageId).toBe('t1-m1'); // the newest message read
    expect(result.missing).toEqual([]);
    expect(result.unreadable).toEqual([]);
  });

  test('a deleted channel (10003) is missing; any other failure is unreadable', async () => {
    const client = makeClient({
      denied: apiError(50001),
      broken: makeChannel('broken', ['x'], { readError: 50013 }),
      foreign: makeChannel('foreign', ['x'], { guildId: '999' }),
    });
    const result = await captureTranscripts(client, GUILD, ['gone', 'denied', 'broken', 'foreign']);

    expect(result.missing).toEqual(['gone']);
    expect(result.unreadable).toEqual(['denied', 'broken', 'foreign']);
    expect(result.transcripts).toEqual({});
  });

  test('stops reading at the deadline; the rest count as unreadable', async () => {
    let clock = 0;
    const client = makeClient({ a: makeChannel('a', ['1']), b: makeChannel('b', ['2']) });
    client.channels.fetch = (fetch => async (id: string) => {
      clock += 1_000;
      return fetch(id);
    })(client.channels.fetch);

    const result = await captureTranscripts(client, GUILD, ['a', 'b'], { deadline: 500, now: () => clock });

    expect(Object.keys(result.transcripts)).toEqual(['a']);
    expect(result.unreadable).toEqual(['b']);
  });
});

describe('deleteChannelById', () => {
  test('deletes an existing channel', async () => {
    const channel = makeChannel('c1');
    expect(await deleteChannelById(makeClient({ c1: channel }), GUILD, 'c1', 'test')).toBe('deleted');
    expect(channel.deleted).toBe(true);
  });

  test('an unknown channel is already gone', async () => {
    expect(await deleteChannelById(makeClient({}), GUILD, 'nope', 'test')).toBe('gone');
  });

  test('a fetch or delete failure is "failed", so the caller keeps its row', async () => {
    const client = makeClient({ denied: apiError(50001), locked: makeChannel('locked', [], { deleteError: 50013 }) });
    expect(await deleteChannelById(client, GUILD, 'denied', 'test')).toBe('failed');
    expect(await deleteChannelById(client, GUILD, 'locked', 'test')).toBe('failed');
  });

  test('never deletes a channel that belongs to another guild', async () => {
    const foreign = makeChannel('f', [], { guildId: '999' });
    expect(await deleteChannelById(makeClient({ f: foreign }), GUILD, 'f', 'test')).toBe('failed');
    expect(foreign.deleted).toBe(false);
  });
});

describe('deleteIfExported', () => {
  test('deletes only what the export read, and only while it has no newer message', async () => {
    const same = makeChannel('same', ['old']);
    const updated = makeChannel('updated', ['old']);
    const unread = makeChannel('unread', ['old']);
    const client = makeClient({ same, updated, unread });
    const coverage = exportCoverage(await captureTranscripts(client, GUILD, ['same', 'updated', 'gone']));
    updated.post('appended after the export'); // e.g. a returning user's re-close

    expect(await deleteIfExported(client, GUILD, coverage, 'same', 'test')).toBe('deleted');
    expect(await deleteIfExported(client, GUILD, coverage, 'updated', 'test')).toBe('kept');
    expect(await deleteIfExported(client, GUILD, coverage, 'unread', 'test')).toBe('kept');
    expect(await deleteIfExported(client, GUILD, coverage, 'gone', 'test')).toBe('gone');
    expect([same.deleted, updated.deleted, unread.deleted]).toEqual([true, false, false]);
  });
});
