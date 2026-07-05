/**
 * postTranscriptToThread unit tests.
 *
 * Drives the shared archive spine with a fake thread that records sends and
 * can be made to throw, plus an injected download fake so no test touches the
 * network. Covers post-every-chunk, no-ping, file re-upload, the text-only
 * fallback when an upload is rejected, and rethrow-on-failure behavior both
 * close workflows rely on.
 */

import { describe, expect, test } from 'bun:test';
import { buildHeaderEmbed, postTranscriptToThread } from '../../../../src/utils/ticket/transcriptPoster';
import type { TranscriptChunk } from '../../../../src/utils/ticket/transcriptBuilder';

interface SentPayload {
  content: string;
  files?: unknown[];
  allowedMentions: unknown;
}

function makeThread(opts: { failAt?: number; rejectFiles?: boolean } = {}) {
  const calls: SentPayload[] = [];
  let attempts = 0;
  const thread = {
    send: async (payload: SentPayload) => {
      if (opts.failAt !== undefined && attempts === opts.failAt) throw new Error('send failed');
      attempts++;
      if (opts.rejectFiles && payload.files && payload.files.length > 0) {
        throw new Error('Request entity too large');
      }
      calls.push(payload);
      return {};
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: minimal ForumThreadChannel test double
  return { thread: thread as any, calls };
}

function chunk(content: string, files: TranscriptChunk['files'] = []): TranscriptChunk {
  return { content, files };
}

const ctx = { guildId: 'g1', channelId: 'c1' };
const okDownload = { download: async () => Buffer.from('bytes') };
const failDownload = { download: async () => null };

describe('postTranscriptToThread', () => {
  test('sends every chunk in order and never pings', async () => {
    const { thread, calls } = makeThread();
    await postTranscriptToThread(thread, [chunk('a'), chunk('b'), chunk('c')], ctx);
    expect(calls.map(c => c.content)).toEqual(['a', 'b', 'c']);
    expect(calls.every(c => JSON.stringify(c.allowedMentions) === JSON.stringify({ parse: [] }))).toBe(true);
  });

  test('rethrows and stops at the first chunk that fails to send', async () => {
    const { thread, calls } = makeThread({ failAt: 1 });
    await expect(postTranscriptToThread(thread, [chunk('a'), chunk('b'), chunk('c')], ctx)).rejects.toThrow(
      'send failed',
    );
    expect(calls.map(c => c.content)).toEqual(['a']);
  });

  test('no sends for an empty chunk list', async () => {
    const { thread, calls } = makeThread();
    await postTranscriptToThread(thread, [], ctx);
    expect(calls).toHaveLength(0);
  });

  test('re-uploads downloaded attachments with their chunk', async () => {
    const { thread, calls } = makeThread();
    const files = [
      { name: 'a.png', url: 'https://cdn/a.png' },
      { name: 'b.mp4', url: 'https://cdn/b.mp4' },
    ];
    await postTranscriptToThread(thread, [chunk('with files', files)], ctx, okDownload);
    expect(calls).toHaveLength(1);
    expect(calls[0].files).toHaveLength(2);
  });

  test('failed download degrades to a text-only send (link fallback lives in the content)', async () => {
    const { thread, calls } = makeThread();
    await postTranscriptToThread(thread, [chunk('text', [{ name: 'a.png', url: 'https://cdn/a.png' }])], ctx, failDownload);
    expect(calls).toHaveLength(1);
    expect(calls[0].files).toBeUndefined();
  });

  test('rejected file upload retries the chunk as text-only instead of failing the archive', async () => {
    const { thread, calls } = makeThread({ rejectFiles: true });
    await postTranscriptToThread(thread, [chunk('big one', [{ name: 'huge.mov', url: 'https://cdn/huge.mov' }])], ctx, okDownload);
    expect(calls).toHaveLength(1);
    expect(calls[0].content).toBe('big one');
    expect(calls[0].files).toBeUndefined();
  });
});

describe('buildHeaderEmbed', () => {
  test('maps header data onto an embed with title, color, and fields', () => {
    const embed = buildHeaderEmbed(
      {
        title: '🎫 Support',
        fields: [
          { name: 'Opened', value: '<t:1:f>', inline: true },
          { name: 'Messages', value: '4', inline: true },
        ],
      },
      '#5865F2',
    );
    const json = embed.toJSON();
    expect(json.title).toBe('🎫 Support');
    expect(json.fields).toHaveLength(2);
    expect(json.color).toBe(0x5865f2);
  });
});
