/**
 * Memory thread helpers (v3.16.16).
 *
 * - buildStarterContent: the forum starter message is capped at 2000 chars, so
 *   a long description used to fail thread creation outright (50035).
 * - editMemoryThreadTags: Discord rejects edits to archived threads (50083)
 *   unless `archived: false` rides in the same PATCH, which made Completed
 *   (locked + archived) items impossible to reopen. It unlocks only when the
 *   item moves off Completed, so a lock a moderator set on purpose survives.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildStarterContent,
  editMemoryThreadTags,
  MEMORY_DESCRIPTION_MAX,
} from '../../../../src/utils/memory/threadHelpers';

describe('buildStarterContent', () => {
  test('short description: prefix, description, footer', () => {
    expect(buildStarterContent('Hello', '-# Created by Andrew')).toBe(
      '**Description:**\n\nHello\n\n-# Created by Andrew',
    );
  });

  test('no description: footer only', () => {
    expect(buildStarterContent('', '-# Captured by Andrew')).toBe('-# Captured by Andrew');
  });

  test('a modal-max description with the longest capture footer still fits', () => {
    const footer = `-# Captured from ${'x'.repeat(32)} - [Jump to message](https://discord.com/channels/${'1'.repeat(19)}/${'2'.repeat(19)}/${'3'.repeat(19)})`;
    const content = buildStarterContent('d'.repeat(MEMORY_DESCRIPTION_MAX), footer);
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).not.toContain('(content truncated)');
  });

  test('over-long description is clamped to 2000 with a visible notice; the footer survives', () => {
    const content = buildStarterContent('d'.repeat(4000), '-# Created by Andrew');
    expect(content.length).toBe(2000);
    expect(content).toContain('(content truncated)');
    expect(content.endsWith('-# Created by Andrew')).toBe(true);
  });
});

function makeThread(state: { archived: boolean; locked: boolean }) {
  const edits: Array<Record<string, unknown>> = [];
  const thread = {
    ...state,
    edit: async (opts: Record<string, unknown>) => {
      if (thread.archived && opts.archived !== false) throw new Error('50083: thread is archived');
      edits.push(opts);
      return thread;
    },
  };
  return { thread: thread as any, edits };
}

describe('editMemoryThreadTags', () => {
  test('reopening a Completed (archived + locked) thread unarchives and unlocks in the same edit', async () => {
    const { thread, edits } = makeThread({ archived: true, locked: true });
    const result = await editMemoryThreadTags(thread, ['open'], { from: 'Completed', to: 'Open' });
    expect(edits).toEqual([{ appliedTags: ['open'], archived: false, locked: false }]);
    expect(result).toEqual({ wasArchived: true, reopened: true });
  });

  test('staying Completed unarchives (required for the edit) but leaves the lock alone', async () => {
    const { thread, edits } = makeThread({ archived: true, locked: true });
    const result = await editMemoryThreadTags(thread, ['done'], { from: 'Completed', to: 'Completed' });
    expect(edits).toEqual([{ appliedTags: ['done'], archived: false }]);
    expect(result.reopened).toBe(false);
  });

  test('a change between non-Completed statuses keeps a lock a moderator set', async () => {
    const { thread, edits } = makeThread({ archived: false, locked: true });
    const result = await editMemoryThreadTags(thread, ['wip'], { from: 'Open', to: 'In Progress' });
    expect(edits).toEqual([{ appliedTags: ['wip'] }]);
    expect(result).toEqual({ wasArchived: false, reopened: false });
  });

  test('an open thread only gets its tags edited', async () => {
    const { thread, edits } = makeThread({ archived: false, locked: false });
    const result = await editMemoryThreadTags(thread, ['a', 'b'], { from: 'Open', to: 'Open' });
    expect(edits).toEqual([{ appliedTags: ['a', 'b'] }]);
    expect(result.wasArchived).toBe(false);
  });
});
