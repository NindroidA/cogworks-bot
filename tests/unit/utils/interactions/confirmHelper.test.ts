/**
 * awaitConfirmation unit tests.
 *
 * Drives the helper with a fake interaction whose reply returns a response
 * that resolves (confirm / cancel button) or rejects (timeout), asserting the
 * v3.14.1 contract: a timeout tells the user instead of silently stripping
 * the buttons.
 */

import { describe, expect, test } from 'bun:test';
import { awaitConfirmation } from '../../../../src/utils/interactions/confirmHelper';
import { lang } from '../../../../src/lang';

function makeInteraction(behavior: { resolve?: unknown; reject?: boolean; deferred?: boolean }) {
  const edits: Array<{ content?: string; components?: unknown[] }> = [];
  const replies: unknown[] = [];
  const awaitable = {
    awaitMessageComponent: async () => {
      if (behavior.reject) throw new Error('timeout');
      return behavior.resolve;
    },
  };
  const interaction = {
    deferred: behavior.deferred ?? false,
    reply: async (payload: unknown) => {
      replies.push(payload);
      return awaitable;
    },
    editReply: async (o: { content?: string; components?: unknown[] }) => {
      edits.push(o);
      return awaitable;
    },
  };
  return { interaction, edits, replies };
}

function makeButton(customId: string) {
  const updates: Array<{ content?: string; components?: unknown[] }> = [];
  return {
    button: {
      customId,
      update: async (o: { content?: string; components?: unknown[] }) => {
        updates.push(o);
      },
    },
    updates,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: narrow interaction test doubles
const call = (interaction: unknown) => awaitConfirmation(interaction as any, { message: 'Sure?' });

describe('awaitConfirmation', () => {
  test('returns the acknowledged button interaction on confirm', async () => {
    const { button } = makeButton('confirm_yes');
    const { interaction } = makeInteraction({ resolve: button });

    const result = await call(interaction);

    expect(result?.interaction).toBe(button as never);
  });

  test('returns null and shows the cancelled message on cancel', async () => {
    const { button, updates } = makeButton('confirm_no');
    const { interaction } = makeInteraction({ resolve: button });

    const result = await call(interaction);

    expect(result).toBeNull();
    expect(updates).toHaveLength(1);
    expect(updates[0].content).toBe(lang.errors.cancelled);
  });

  test('deferred interactions get the buttons via editReply, not a second reply (v3.14.6)', async () => {
    const { button } = makeButton('confirm_yes');
    const { interaction, edits, replies } = makeInteraction({ resolve: button, deferred: true });

    const result = await call(interaction);

    expect(result?.interaction).toBe(button as never);
    expect(replies).toHaveLength(0);
    expect(edits).toHaveLength(1);
    expect(edits[0].content).toBe('Sure?');
  });

  test('timeout tells the user and clears the buttons (not a silent strip)', async () => {
    const { interaction, edits } = makeInteraction({ reject: true });

    const result = await call(interaction);

    expect(result).toBeNull();
    expect(edits).toHaveLength(1);
    expect(edits[0].content).toBe(lang.errors.timeout);
    expect(edits[0].components).toEqual([]);
  });
});
