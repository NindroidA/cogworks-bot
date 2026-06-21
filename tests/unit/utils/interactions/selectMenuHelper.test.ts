/**
 * awaitSelectMenuChoice unit tests.
 *
 * Drives the helper with a fake response whose awaitMessageComponent resolves
 * (a select / a non-select) or rejects (timeout), and a fake interaction that
 * records editReply calls.
 */

import { describe, expect, test } from 'bun:test';
import { awaitSelectMenuChoice } from '../../../../src/utils/interactions/selectMenuHelper';

function makeResponse(behavior: { resolve?: unknown; reject?: boolean }) {
  return {
    awaitMessageComponent: async () => {
      if (behavior.reject) throw new Error('timeout');
      return behavior.resolve;
    },
  };
}

function makeInteraction() {
  const edits: Array<{ content?: string; components?: unknown[] }> = [];
  return {
    interaction: {
      editReply: async (o: { content?: string; components?: unknown[] }) => {
        edits.push(o);
      },
    },
    edits,
  };
}

const opts = { userId: 'u1', customId: 'pick' };
// biome-ignore lint/suspicious/noExplicitAny: narrow interaction/response test doubles
const call = (interaction: unknown, response: unknown) => awaitSelectMenuChoice(interaction as any, response as any, opts);

describe('awaitSelectMenuChoice', () => {
  test('returns the select interaction when the user makes a choice', async () => {
    const picked = { isStringSelectMenu: () => true, values: ['5'] };
    const { interaction, edits } = makeInteraction();

    const result = await call(interaction, makeResponse({ resolve: picked }));

    expect(result).toBe(picked as never);
    expect(result?.values).toEqual(['5']);
    expect(edits).toHaveLength(0);
  });

  test('returns null and clears the menu with the timeout message on timeout', async () => {
    const { interaction, edits } = makeInteraction();

    const result = await call(interaction, makeResponse({ reject: true }));

    expect(result).toBeNull();
    expect(edits).toHaveLength(1);
    expect(edits[0].components).toEqual([]);
  });

  test('returns null for a non-select component', async () => {
    const { interaction } = makeInteraction();

    const result = await call(interaction, makeResponse({ resolve: { isStringSelectMenu: () => false } }));

    expect(result).toBeNull();
  });
});
