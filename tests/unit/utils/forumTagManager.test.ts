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
import { applyForumTags } from '../../../src/utils/forumTagManager';

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
  test('accumulates onto the thread\'s live tags (manual tags survive)', async () => {
    const { forum, applied } = makeForum(['manual-1']);
    await applyForumTags(forum, 't1', ['db-1', 'db-2']);
    expect(applied).toEqual([['manual-1', 'db-1', 'db-2']]);
  });

  test('dedupes incoming tags already on the thread', async () => {
    const { forum, applied } = makeForum(['a', 'b']);
    await applyForumTags(forum, 't1', ['b', 'c']);
    expect(applied).toEqual([['a', 'b', 'c']]);
  });

  test('caps at 5 tags, keeping live tags first and dropping the overflow', async () => {
    const { forum, applied } = makeForum(['l1', 'l2', 'l3', 'l4']);
    await applyForumTags(forum, 't1', ['n1', 'n2']);
    expect(applied).toEqual([['l1', 'l2', 'l3', 'l4', 'n1']]);
  });

  test('empty/blank incoming tags are a no-op (no fetch, no write)', async () => {
    const { forum, applied } = makeForum(['a']);
    await applyForumTags(forum, 't1', ['']);
    expect(applied).toHaveLength(0);
  });

  test('missing thread is a silent no-op', async () => {
    const { forum, applied } = makeForum(null, { threadMissing: true });
    await applyForumTags(forum, 't1', ['a']);
    expect(applied).toHaveLength(0);
  });

  test('null appliedTags on the thread is treated as empty', async () => {
    const { forum, applied } = makeForum(null);
    await applyForumTags(forum, 't1', ['a']);
    expect(applied).toEqual([['a']]);
  });
});
