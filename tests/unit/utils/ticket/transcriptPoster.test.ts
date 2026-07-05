/**
 * postTranscriptToThread unit tests.
 *
 * Drives the shared archive spine with a fake thread that records sends and
 * can be made to throw, plus an injected download fake so no test touches the
 * network. Covers post-every-chunk, no-ping, file re-upload, aggregate-size
 * batching, the per-file rescue when Discord rejects a payload (40005), the
 * rethrow-on-anything-else contract both close workflows rely on, and the
 * hardened real download path (size caps, timeout seam, lying Content-Length).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  batchBySize,
  buildHeaderEmbed,
  downloadAttachment,
  isUploadRejection,
  postTranscriptToThread,
} from '../../../../src/utils/ticket/transcriptPoster';
import type { TranscriptChunk } from '../../../../src/utils/ticket/transcriptBuilder';
import { MAX } from '../../../../src/utils/constants';

interface SentPayload {
  content?: string;
  files?: unknown[];
  allowedMentions: unknown;
}

function uploadRejection(): Error {
  return Object.assign(new Error('Request entity too large'), { code: 40005 });
}

function makeThread(opts: { failAt?: number; rejectFileSends?: 'always' | 'batch-only' } = {}) {
  const calls: SentPayload[] = [];
  let attempts = 0;
  const thread = {
    send: async (payload: SentPayload) => {
      if (opts.failAt !== undefined && attempts === opts.failAt) throw new Error('send failed');
      attempts++;
      const fileCount = payload.files?.length ?? 0;
      if (opts.rejectFileSends === 'always' && fileCount > 0) throw uploadRejection();
      if (opts.rejectFileSends === 'batch-only' && fileCount > 1) throw uploadRejection();
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
    await postTranscriptToThread(
      thread,
      [chunk('text', [{ name: 'a.png', url: 'https://cdn/a.png' }])],
      ctx,
      failDownload,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].files).toBeUndefined();
  });

  test('40005 batch rejection lands the text, then rescues each file individually', async () => {
    const { thread, calls } = makeThread({ rejectFileSends: 'batch-only' });
    const files = [
      { name: 'a.png', url: 'https://cdn/a.png' },
      { name: 'b.png', url: 'https://cdn/b.png' },
    ];
    await postTranscriptToThread(thread, [chunk('big batch', files)], ctx, okDownload);
    // text-only send + one send per file
    expect(calls).toHaveLength(3);
    expect(calls[0].content).toBe('big batch');
    expect(calls[0].files).toBeUndefined();
    expect(calls[1].files).toHaveLength(1);
    expect(calls[2].files).toHaveLength(1);
  });

  test('a file Discord rejects even alone is skipped — its link fallback stands', async () => {
    const { thread, calls } = makeThread({ rejectFileSends: 'always' });
    await postTranscriptToThread(
      thread,
      [chunk('text', [{ name: 'cursed.bin', url: 'https://cdn/cursed.bin' }])],
      ctx,
      okDownload,
    );
    // batch send rejected → text lands → per-file send also rejected → skipped
    expect(calls).toHaveLength(1);
    expect(calls[0].content).toBe('text');
  });

  test('NON-rejection file-send errors rethrow so the archive retries (files are never silently lost)', async () => {
    const thread = {
      send: async (payload: SentPayload) => {
        if ((payload.files?.length ?? 0) > 0) throw new Error('Missing Permissions');
        return {};
      },
    };
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: minimal test double
      postTranscriptToThread(thread as any, [chunk('t', [{ name: 'a.png', url: 'https://cdn/a.png' }])], ctx, okDownload),
    ).rejects.toThrow('Missing Permissions');
  });
});

describe('isUploadRejection', () => {
  test('recognizes payload rejections and nothing else', () => {
    expect(isUploadRejection(Object.assign(new Error('x'), { code: 40005 }))).toBe(true);
    expect(isUploadRejection(Object.assign(new Error('x'), { code: 50035 }))).toBe(true);
    expect(isUploadRejection(Object.assign(new Error('x'), { status: 413 }))).toBe(true);
    expect(isUploadRejection(Object.assign(new Error('x'), { code: 50013 }))).toBe(false);
    expect(isUploadRejection(new Error('network'))).toBe(false);
    expect(isUploadRejection(undefined)).toBe(false);
  });
});

describe('batchBySize', () => {
  const file = (name: string, bytes: number) => ({ name, buffer: Buffer.alloc(bytes) });

  test('packs greedily under the budget, preserving order', () => {
    const batches = batchBySize([file('a', 4), file('b', 4), file('c', 4)], 10);
    expect(batches.map(b => b.map(f => f.name))).toEqual([['a', 'b'], ['c']]);
  });

  test('a single file over budget still gets its own batch (send decides its fate)', () => {
    const batches = batchBySize([file('big', 20), file('a', 2)], 10);
    expect(batches.map(b => b.map(f => f.name))).toEqual([['big'], ['a']]);
  });

  test('empty input produces no batches', () => {
    expect(batchBySize([], 10)).toEqual([]);
  });
});

describe('downloadAttachment (real path, mocked fetch)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const mockFetch = (fn: () => Promise<unknown>) => {
    // biome-ignore lint/suspicious/noExplicitAny: fetch test double
    globalThis.fetch = fn as any;
  };

  const okResponse = (bytes: number, contentLength?: number) => ({
    ok: true,
    headers: { get: (h: string) => (h === 'content-length' ? String(contentLength ?? bytes) : null) },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  });

  test('declared size over the cap skips the fetch entirely', async () => {
    let fetched = false;
    mockFetch(async () => {
      fetched = true;
      return okResponse(1);
    });
    const result = await downloadAttachment({
      name: 'huge.mov',
      url: 'https://cdn/huge.mov',
      size: MAX.TRANSCRIPT_REUPLOAD_BYTES + 1,
    });
    expect(result).toBeNull();
    expect(fetched).toBe(false);
  });

  test('happy path returns the buffer', async () => {
    mockFetch(async () => okResponse(16));
    const result = await downloadAttachment({ name: 'a.png', url: 'https://cdn/a.png', size: 16 });
    expect(result?.byteLength).toBe(16);
  });

  test('non-ok response returns null', async () => {
    mockFetch(async () => ({ ...okResponse(4), ok: false }));
    expect(await downloadAttachment({ name: 'a.png', url: 'https://cdn/a.png' })).toBeNull();
  });

  test('Content-Length over the cap returns null before buffering', async () => {
    mockFetch(async () => okResponse(4, MAX.TRANSCRIPT_REUPLOAD_BYTES + 1));
    expect(await downloadAttachment({ name: 'a.png', url: 'https://cdn/a.png' })).toBeNull();
  });

  test('a lying Content-Length is caught by the final buffer check', async () => {
    mockFetch(async () => okResponse(MAX.TRANSCRIPT_REUPLOAD_BYTES + 1, 4));
    expect(await downloadAttachment({ name: 'a.png', url: 'https://cdn/a.png' })).toBeNull();
  });

  test('fetch failure returns null', async () => {
    mockFetch(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await downloadAttachment({ name: 'a.png', url: 'https://cdn/a.png' })).toBeNull();
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
