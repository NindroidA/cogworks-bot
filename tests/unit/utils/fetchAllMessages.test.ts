/**
 * fetchMessagesAsTranscript mapping tests.
 *
 * The pure builder (transcriptBuilder.test.ts) is driven with synthetic
 * TranscriptMessage[] and never validates that the FETCHER actually populates
 * those fields from a real discord.js Message. A wrong field path
 * (e.g. m.poll.question vs m.poll.question.text, or a missing Collection→array
 * conversion) would compile fine but silently drop content at runtime. These
 * tests pin the mapping, plus one fetch→build integration check that a genuinely
 * >2000-char message survives end-to-end.
 */

import { describe, expect, test } from 'bun:test';
import { fetchMessagesAsTranscript } from '../../../src/utils/fetchAllMessages';
import { buildTranscript, type TicketMetadata } from '../../../src/utils/ticket/transcriptBuilder';

// --- fake discord.js Message construction -------------------------------------

function makeMsg(overrides: Record<string, any> = {}): any {
  return {
    id: 'm1',
    author: { username: 'alice', id: '111', bot: false },
    content: 'hello',
    cleanContent: 'hello',
    createdAt: new Date('2026-04-01T12:00:00Z'),
    attachments: new Map(),
    embeds: [],
    stickers: new Map(),
    poll: null,
    reference: undefined,
    system: false,
    components: [],
    ...overrides,
  };
}

// Mimics discord.js Collection.fetch result: .size, .values(), .last().
function makeBatch(messages: any[]) {
  return {
    size: messages.length,
    values: () => messages.values(),
    last: () => messages[messages.length - 1],
  };
}

// One page of messages then an empty page (terminates the pagination loop).
function makeChannel(messages: any[]): any {
  let served = false;
  return {
    messages: {
      fetch: async () => {
        if (served) return makeBatch([]);
        served = true;
        return makeBatch(messages);
      },
    },
  };
}

const META: TicketMetadata = {
  title: 'T',
  type: 'T',
  createdByUsername: 'alice',
  openedAt: new Date('2026-04-01T12:00:00Z'),
  closedAt: new Date('2026-04-01T12:30:00Z'),
  assignedToUsername: null,
};

describe('fetchMessagesAsTranscript mapping', () => {
  test('maps embed url/author/footer/image/thumbnail/color + fields', async () => {
    const msg = makeMsg({
      embeds: [
        {
          title: 'T',
          description: 'D',
          url: 'https://e/x',
          author: { name: 'ci-bot' },
          footer: { text: 'foot' },
          image: { url: 'https://cdn/i.png' },
          thumbnail: { url: 'https://cdn/t.png' },
          color: 0x5865f2,
          fields: [{ name: 'k', value: 'v' }],
        },
      ],
    });
    const [out] = await fetchMessagesAsTranscript(makeChannel([msg]), 'bot-id');
    expect(out.embeds[0]).toEqual({
      title: 'T',
      description: 'D',
      url: 'https://e/x',
      author: 'ci-bot',
      footer: 'foot',
      imageUrl: 'https://cdn/i.png',
      thumbnailUrl: 'https://cdn/t.png',
      color: 0x5865f2,
      fields: [{ name: 'k', value: 'v' }],
    });
  });

  test('absent embed sub-objects map to undefined (no crash)', async () => {
    const msg = makeMsg({
      embeds: [{ title: null, description: 'only desc', url: null, author: null, footer: null, image: null, thumbnail: null, color: null, fields: [] }],
    });
    const [out] = await fetchMessagesAsTranscript(makeChannel([msg]), 'bot-id');
    expect(out.embeds[0].description).toBe('only desc');
    expect(out.embeds[0].author).toBeUndefined();
    expect(out.embeds[0].imageUrl).toBeUndefined();
    expect(out.embeds[0].color).toBeUndefined();
  });

  test('maps stickers (name + url)', async () => {
    const stickers = new Map([['s1', { name: 'party', url: 'https://cdn/s.png' }]]);
    const [out] = await fetchMessagesAsTranscript(makeChannel([makeMsg({ stickers })]), 'bot-id');
    expect(out.stickers).toEqual([{ name: 'party', url: 'https://cdn/s.png' }]);
  });

  test('maps a poll (question.text + per-answer text/voteCount)', async () => {
    const poll = {
      question: { text: 'Best color?' },
      answers: new Map([
        [1, { text: 'Red', voteCount: 3 }],
        [2, { text: 'Blue', voteCount: 1 }],
      ]),
    };
    const [out] = await fetchMessagesAsTranscript(makeChannel([makeMsg({ poll })]), 'bot-id');
    expect(out.poll).toEqual({
      question: 'Best color?',
      answers: [
        { text: 'Red', voteCount: 3 },
        { text: 'Blue', voteCount: 1 },
      ],
    });
  });

  test('no poll → poll:null; no stickers → []', async () => {
    const [out] = await fetchMessagesAsTranscript(makeChannel([makeMsg()]), 'bot-id');
    expect(out.poll).toBeNull();
    expect(out.stickers).toEqual([]);
  });

  test('null poll question text maps to empty string (no crash)', async () => {
    const poll = { question: { text: null }, answers: new Map([[1, { text: null, voteCount: 0 }]]) };
    const [out] = await fetchMessagesAsTranscript(makeChannel([makeMsg({ poll })]), 'bot-id');
    expect(out.poll).toEqual({ question: '', answers: [{ text: '', voteCount: 0 }] });
  });

  test('classifies a bot component-only message as hasOnlyComponents', async () => {
    const msg = makeMsg({
      author: { username: 'cog', id: 'bot-id', bot: true },
      content: '',
      cleanContent: '',
      components: [{ type: 1 }],
    });
    const [out] = await fetchMessagesAsTranscript(makeChannel([msg]), 'bot-id');
    expect(out.hasOnlyComponents).toBe(true);
  });
});

describe('fetch → build integration', () => {
  test('a single >2000-char message survives end-to-end with every chunk <= 2000', async () => {
    const body = `START-${'q'.repeat(5000)}-END`;
    const msg = makeMsg({ content: body, cleanContent: body });
    const transcriptMessages = await fetchMessagesAsTranscript(makeChannel([msg]), 'bot-id');
    expect(transcriptMessages[0].content).toBe(body); // fetcher preserved it whole

    const result = buildTranscript(transcriptMessages, META);
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    const flat = result.chunks.join('\n').replace(/\n> /g, '').replace(/^> /gm, '');
    expect(flat).toContain('START-');
    expect(flat).toContain('-END');
    expect(flat.split('q').length - 1).toBe(5000);
  });
});
