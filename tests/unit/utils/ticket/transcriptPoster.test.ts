/**
 * postTranscriptToThread unit tests.
 *
 * Drives the shared archive spine with a fake thread that records sends and can
 * be made to throw, covering the post-every-chunk, no-ping, and rethrow-on-
 * failure behavior both close workflows rely on.
 */

import { describe, expect, test } from 'bun:test';
import { postTranscriptToThread } from '../../../../src/utils/ticket/transcriptPoster';

function makeThread(opts: { failAt?: number } = {}) {
  const calls: Array<{ content: string; allowedMentions: unknown }> = [];
  const thread = {
    send: async (payload: { content: string; allowedMentions: unknown }) => {
      if (opts.failAt !== undefined && calls.length === opts.failAt) throw new Error('send failed');
      calls.push(payload);
      return {};
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: minimal ForumThreadChannel test double
  return { thread: thread as any, calls };
}

const ctx = { guildId: 'g1', channelId: 'c1' };

describe('postTranscriptToThread', () => {
  test('sends every chunk in order and never pings', async () => {
    const { thread, calls } = makeThread();
    await postTranscriptToThread(thread, ['a', 'b', 'c'], ctx);
    expect(calls.map(c => c.content)).toEqual(['a', 'b', 'c']);
    expect(calls.every(c => JSON.stringify(c.allowedMentions) === JSON.stringify({ parse: [] }))).toBe(true);
  });

  test('rethrows and stops at the first chunk that fails to send', async () => {
    const { thread, calls } = makeThread({ failAt: 1 });
    await expect(postTranscriptToThread(thread, ['a', 'b', 'c'], ctx)).rejects.toThrow('send failed');
    expect(calls.map(c => c.content)).toEqual(['a']);
  });

  test('no sends for an empty chunk list', async () => {
    const { thread, calls } = makeThread();
    await postTranscriptToThread(thread, [], ctx);
    expect(calls).toHaveLength(0);
  });
});
