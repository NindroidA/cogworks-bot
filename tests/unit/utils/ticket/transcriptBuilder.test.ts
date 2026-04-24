/**
 * transcriptBuilder unit tests.
 *
 * The builder is pure over TranscriptMessage[] — no Discord client — so
 * these tests can drive it with synthetic arrays and assert on the exact
 * markdown output.
 */

import { describe, expect, test } from '@jest/globals';
import {
  buildTranscript,
  chunkByMessageBoundary,
  formatDurationShort,
  formatHeader,
  formatMessage,
  type TicketMetadata,
  type TranscriptMessage,
  truncateLongMessage,
} from '../../../../src/utils/ticket/transcriptBuilder';

function makeMessage(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    author: { username: 'alice', id: '111', bot: false },
    content: 'Hello world',
    timestamp: new Date('2026-04-01T12:00:00Z'),
    attachments: [],
    embeds: [],
    isSystem: false,
    hasOnlyComponents: false,
    ...overrides,
  };
}

const META: TicketMetadata = {
  title: 'Ban Appeal',
  type: 'Ban Appeal',
  createdByUsername: 'alice',
  openedAt: new Date('2026-04-01T12:00:00Z'),
  closedAt: new Date('2026-04-01T14:14:00Z'),
  assignedToUsername: 'staff_bob',
};

describe('formatDurationShort()', () => {
  test('under a minute renders as <1m', () => {
    expect(formatDurationShort(5_000)).toBe('<1m');
  });

  test('minutes-only', () => {
    expect(formatDurationShort(47 * 60_000)).toBe('47m');
  });

  test('hours-and-minutes', () => {
    expect(formatDurationShort(2 * 60 * 60_000 + 14 * 60_000)).toBe('2h 14m');
  });

  test('hours-only when minutes are zero', () => {
    expect(formatDurationShort(3 * 60 * 60_000)).toBe('3h');
  });

  test('multi-day duration', () => {
    expect(formatDurationShort(3 * 24 * 60 * 60_000 + 5 * 60 * 60_000)).toBe('3d 5h');
  });

  test('multi-day duration with no hours', () => {
    expect(formatDurationShort(2 * 24 * 60 * 60_000)).toBe('2d');
  });
});

describe('truncateLongMessage()', () => {
  test('short content passes through unchanged', () => {
    expect(truncateLongMessage('short', 500)).toBe('short');
  });

  test('exceeds limit — appends truncation marker', () => {
    const body = 'x'.repeat(600);
    const result = truncateLongMessage(body, 500);
    expect(result).toHaveLength(500 + '… (truncated)'.length);
    expect(result.endsWith('… (truncated)')).toBe(true);
  });
});

describe('formatHeader()', () => {
  test('contains all required metadata lines', () => {
    const header = formatHeader(META, 5, 2);
    expect(header).toContain('# 🎫 Ticket: Ban Appeal');
    expect(header).toContain('**Created by:** alice');
    expect(header).toContain('**Type:** Ban Appeal');
    expect(header).toContain('**Assigned to:** staff_bob');
    expect(header).toContain('**Messages:** 5');
    expect(header).toContain('**Attachments:** 2');
    expect(header).toContain('**Duration:** 2h 14m');
  });

  test('omits the attachments line when count is zero', () => {
    const header = formatHeader(META, 3, 0);
    expect(header).not.toContain('**Attachments:**');
  });

  test('renders Unassigned when assigneeUsername is null', () => {
    const header = formatHeader({ ...META, assignedToUsername: null }, 1, 0);
    expect(header).toContain('**Assigned to:** Unassigned');
  });
});

describe('formatMessage()', () => {
  test('plain text becomes a blockquote', () => {
    const out = formatMessage(makeMessage({ content: 'Hello\nWorld' }));
    expect(out).toContain('**alice**');
    expect(out).toContain('> Hello');
    expect(out).toContain('> World');
  });

  test('reply adds ↩️ suffix with original author', () => {
    const out = formatMessage(
      makeMessage({
        content: 'got it',
        replyTo: { author: 'staff_bob', content: 'please confirm' },
      }),
    );
    expect(out).toContain('↩️ *replying to staff_bob*');
  });

  test('multiple attachments render each on its own line', () => {
    const out = formatMessage(
      makeMessage({
        content: '',
        attachments: [
          { name: 'img.png', url: 'https://cdn/img.png', contentType: 'image/png' },
          { name: 'log.txt', url: 'https://cdn/log.txt' },
        ],
      }),
    );
    expect(out).toContain('> 📎 [img.png](https://cdn/img.png)');
    expect(out).toContain('> 📎 [log.txt](https://cdn/log.txt)');
  });

  test('attachment with empty URL renders as unavailable', () => {
    const out = formatMessage(
      makeMessage({
        content: '',
        attachments: [{ name: 'gone.pdf', url: '' }],
      }),
    );
    expect(out).toContain('> 📎 ~~gone.pdf~~ (unavailable)');
  });

  test('code block content is preserved inside the blockquote', () => {
    const content = '```js\nconst x = 1;\n```';
    const out = formatMessage(makeMessage({ content }));
    expect(out).toContain('> ```js');
    expect(out).toContain('> const x = 1;');
  });

  test('embed with title + description renders indented under the message', () => {
    const out = formatMessage(
      makeMessage({
        content: '',
        embeds: [{ title: 'Heads up', description: 'This is important', fields: [] }],
      }),
    );
    expect(out).toContain('**Heads up**');
    expect(out).toContain('This is important');
  });

  test('empty message falls back to placeholder so the header still lines up', () => {
    const out = formatMessage(makeMessage({ content: '' }));
    expect(out).toContain('*(no content)*');
  });

  test('long single message is truncated inline', () => {
    const out = formatMessage(makeMessage({ content: 'x'.repeat(2000) }));
    expect(out).toContain('… (truncated)');
  });
});

describe('chunkByMessageBoundary()', () => {
  test('small messages fit in one chunk', () => {
    const chunks = chunkByMessageBoundary(['aaa', 'bbb', 'ccc'], 1900);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('aaa');
    expect(chunks[0]).toContain('ccc');
  });

  test('splits on message boundary when buffer would exceed limit', () => {
    const big = 'x'.repeat(1000);
    const chunks = chunkByMessageBoundary([big, big, big], 1900);
    // 1000 + 2 + 1000 = 2002 > 1900, so each chunk holds one message.
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
  });

  test('individual oversized message is kept intact (caller truncated it already)', () => {
    const oversize = 'y'.repeat(3000);
    const chunks = chunkByMessageBoundary([oversize], 1900);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(oversize);
  });

  test('never splits mid-message even when two back-to-back fit but a third does not', () => {
    const mid = 'z'.repeat(900);
    const chunks = chunkByMessageBoundary([mid, mid, mid], 1900);
    // First chunk: mid + '\n\n' + mid = 1802 ≤ 1900 → fits. Third goes alone.
    expect(chunks).toHaveLength(2);
  });
});

describe('buildTranscript()', () => {
  test('filters system + component-only messages', () => {
    const messages: TranscriptMessage[] = [
      makeMessage({ content: 'real message from alice' }),
      makeMessage({ content: '', isSystem: true }),
      makeMessage({ content: '', hasOnlyComponents: true }),
      makeMessage({
        author: { username: 'bob', id: '222', bot: false },
        content: 'another real message',
      }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(2);
    expect(result.chunks.join('\n')).toContain('real message from alice');
    expect(result.chunks.join('\n')).toContain('another real message');
  });

  test('counts attachments across surviving messages', () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: 'pics or it didnt happen',
        attachments: [
          { name: 'a.png', url: 'https://cdn/a.png' },
          { name: 'b.png', url: 'https://cdn/b.png' },
        ],
      }),
      makeMessage({
        content: '',
        hasOnlyComponents: true,
        attachments: [{ name: 'filtered-out.png', url: 'https://cdn/f.png' }],
      }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.attachmentCount).toBe(2);
  });

  test('empty ticket produces a placeholder chunk', () => {
    const result = buildTranscript([], META);
    expect(result.messageCount).toBe(0);
    expect(result.chunks).toEqual(['*(No messages)*']);
  });

  test('bot-only ticket (only system/component noise) returns the human-empty placeholder', () => {
    const messages: TranscriptMessage[] = [
      makeMessage({ content: '', isSystem: true }),
      makeMessage({ content: '', hasOnlyComponents: true }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(0);
    expect(result.chunks).toEqual(['*(No human messages)*']);
  });

  test('preserves chronological ordering', () => {
    const messages: TranscriptMessage[] = [
      makeMessage({ content: 'first', timestamp: new Date('2026-04-01T12:00:00Z') }),
      makeMessage({
        author: { username: 'bob', id: '222', bot: false },
        content: 'second',
        timestamp: new Date('2026-04-01T12:05:00Z'),
      }),
      makeMessage({ content: 'third', timestamp: new Date('2026-04-01T12:10:00Z') }),
    ];
    const result = buildTranscript(messages, META);
    const joined = result.chunks.join('\n');
    expect(joined.indexOf('first')).toBeLessThan(joined.indexOf('second'));
    expect(joined.indexOf('second')).toBeLessThan(joined.indexOf('third'));
  });
});
