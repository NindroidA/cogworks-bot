/**
 * applyForumTags unit tests — pins the v3.14.2 accumulation fix.
 *
 * setAppliedTags REPLACES a thread's tags, so the pre-fix implementation
 * wiped any tag a moderator had added by hand whenever a re-close applied the
 * DB-tracked list. These tests lock in: live tags survive, incoming tags
 * dedupe against them, and the 5-tag Discord cap drops the overflow (logged)
 * rather than throwing.
 */

import { describe, expect, test } from 'bun:test';
import {
  applyForumTags,
  ensureForumTag,
  forumTagName,
  mergeForumTags,
  toForumTagEmoji,
} from '../../../src/utils/forumTagManager';

function makeForum(liveTags: string[] | null, opts: { threadMissing?: boolean } = {}) {
  const applied: string[][] = [];
  const thread = {
    appliedTags: liveTags,
    setAppliedTags: async (tags: string[]) => {
      applied.push(tags);
    },
  };
  const forum = {
    threads: {
      fetch: async () => (opts.threadMissing ? null : thread),
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: minimal ForumChannel test double
  return { forum: forum as any, applied };
}

describe('applyForumTags', () => {
  test("accumulates onto the thread's live tags (manual tags survive) and returns what was applied", async () => {
    const { forum, applied } = makeForum(['manual-1']);
    const result = await applyForumTags(forum, 't1', ['db-1', 'db-2']);
    expect(applied).toEqual([['manual-1', 'db-1', 'db-2']]);
    expect(result).toEqual(['manual-1', 'db-1', 'db-2']);
  });

  test('dedupes incoming tags already on the thread', async () => {
    const { forum, applied } = makeForum(['a', 'b']);
    await applyForumTags(forum, 't1', ['b', 'c']);
    expect(applied).toEqual([['a', 'b', 'c']]);
  });

  test('caps at 5 tags, keeping live tags first — the return value reveals the drop', async () => {
    const { forum, applied } = makeForum(['l1', 'l2', 'l3', 'l4']);
    const result = await applyForumTags(forum, 't1', ['n1', 'n2']);
    expect(applied).toEqual([['l1', 'l2', 'l3', 'l4', 'n1']]);
    expect(result).toEqual(['l1', 'l2', 'l3', 'l4', 'n1']);
    expect(result).not.toContain('n2');
  });

  test('empty/blank incoming tags are a no-op returning null (no fetch, no write)', async () => {
    const { forum, applied } = makeForum(['a']);
    expect(await applyForumTags(forum, 't1', [''])).toBeNull();
    expect(applied).toHaveLength(0);
  });

  test('missing thread is a silent no-op returning null', async () => {
    const { forum, applied } = makeForum(null, { threadMissing: true });
    expect(await applyForumTags(forum, 't1', ['a'])).toBeNull();
    expect(applied).toHaveLength(0);
  });

  test('null appliedTags on the thread is treated as empty', async () => {
    const { forum, applied } = makeForum(null);
    await applyForumTags(forum, 't1', ['a']);
    expect(applied).toEqual([['a']]);
  });
});

describe('mergeForumTags', () => {
  function makeTagForum(tags: Array<{ id: string; name: string }>) {
    const sent: unknown[][] = [];
    const forum = {
      id: 'forum-1',
      availableTags: tags.map(t => ({ ...t, moderated: false, emoji: null })),
      setAvailableTags: async (next: Array<{ id?: string; name: string }>) => {
        sent.push(next);
        let n = 0;
        return { availableTags: next.map(t => ({ ...t, id: t.id ?? `new-${++n}` })) };
      },
    };
    return { forum: forum as any, sent };
  }

  test("keeps every existing tag (with its id) and appends only what's missing", async () => {
    const { forum, sent } = makeTagForum([
      { id: 'c1', name: 'Curated' },
      { id: 'b1', name: 'bug' },
    ]);
    const { ids, skipped } = await mergeForumTags(forum, [
      { name: 'Bug', emoji: '🐛' },
      { name: 'Note', emoji: null },
    ]);

    expect(sent).toHaveLength(1);
    const payload = sent[0] as Array<{ id?: string; name: string }>;
    expect(payload.slice(0, 2).map(t => t.id)).toEqual(['c1', 'b1']);
    expect(payload.map(t => t.name)).toEqual(['Curated', 'bug', 'Note']);
    // Case-insensitive name match reuses the existing tag's id
    expect(ids.get('Bug')).toBe('b1');
    expect(ids.get('Note')).toBe('new-1');
    expect(skipped).toEqual([]);
  });

  test('no PATCH when every seed already exists', async () => {
    const { forum, sent } = makeTagForum([{ id: 'o1', name: 'Open' }]);
    const { ids } = await mergeForumTags(forum, [{ name: 'Open', emoji: null }]);
    expect(sent).toHaveLength(0);
    expect(ids.get('Open')).toBe('o1');
  });

  test('stops at the 20-tag cap and reports what was skipped', async () => {
    const existing = Array.from({ length: 19 }, (_, i) => ({ id: `t${i}`, name: `Tag ${i}` }));
    const { forum, sent } = makeTagForum(existing);
    const { ids, skipped } = await mergeForumTags(forum, [
      { name: 'A', emoji: null },
      { name: 'B', emoji: null },
    ]);
    expect((sent[0] as unknown[]).length).toBe(20);
    expect(skipped).toEqual(['B']);
    expect(ids.get('A')).toBe('new-1');
    expect(ids.get('B')).toBeNull();
  });
});

describe('toForumTagEmoji', () => {
  test('unicode, custom and empty emoji', () => {
    expect(toForumTagEmoji('🐛')).toEqual({ id: null, name: '🐛' });
    expect(toForumTagEmoji('<:cog:123456789012345678>')).toEqual({ id: '123456789012345678', name: 'cog' });
    expect(toForumTagEmoji(null)).toBeNull();
  });
});

// v3.16.32: Discord caps tag names at 20 characters, so a longer position or
// ticket type name was rejected on every close and never tagged.
describe('forumTagName', () => {
  test('short names are unchanged; long ones drop a trailing " Application", then cut at 20', () => {
    expect(forumTagName('Moderator')).toBe('Moderator');
    expect(forumTagName('Staff Application')).toBe('Staff Application');
    expect(forumTagName('Developer Application')).toBe('Developer');
    expect(forumTagName('Content Creator Application')).toBe('Content Creator');
    expect(forumTagName('Hardware Support And Repairs')).toBe('Hardware Support And');
  });
});

describe('ensureForumTag', () => {
  test('finds the existing 20-char tag for a long name', async () => {
    const forum = { id: 'f1', availableTags: [{ id: 't1', name: 'Developer' }], setAvailableTags: async () => {} };
    // biome-ignore lint/suspicious/noExplicitAny: minimal ForumChannel test double
    expect(await ensureForumTag(forum as any, 'position_1', 'Developer Application', null)).toBe('t1');
  });

  test('creates the tag under its 20-char name', async () => {
    const sent: { name: string }[][] = [];
    const forum = {
      id: 'f1',
      availableTags: [] as { id: string; name: string }[],
      setAvailableTags: async (tags: { name: string }[]) => {
        sent.push(tags);
      },
      fetch: async () => ({ availableTags: [{ id: 't9', name: 'Partnership' }] }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal ForumChannel test double
    expect(await ensureForumTag(forum as any, 'position_2', 'Partnership Application', null)).toBe('t9');
    expect(sent[0][0].name).toBe('Partnership');
  });
});
