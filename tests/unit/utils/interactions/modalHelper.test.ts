/**
 * extractModalField / extractModalBoolean unit tests.
 *
 * Both are pure over a ModalSubmitFields-like `{ getField(id) }` — no Discord
 * client — so a hand-rolled fake suffices. These pin the field-type tolerance
 * (text `.value`, select `.values[]`) and the checkbox-as-boolean fix:
 * extractModalField must NOT stringify a checkbox (which would make an unchecked
 * box the truthy "false"), and extractModalBoolean must coerce it correctly.
 */

import { describe, expect, jest, test } from 'bun:test';
import { ModalBuilder } from 'discord.js';
import {
  extractModalBoolean,
  extractModalField,
  showAndAwaitModal,
} from '../../../../src/utils/interactions/modalHelper';

function fakeFields(map: Record<string, unknown>): any {
  return { getField: (id: string) => (id in map ? map[id] : null) };
}

describe('extractModalField', () => {
  test('reads a text input .value', () => {
    expect(extractModalField(fakeFields({ name: { value: 'hello' } }), 'name')).toBe('hello');
  });

  test('reads a select component .values[0]', () => {
    expect(extractModalField(fakeFields({ role: { values: ['123', '456'] } }), 'role')).toBe('123');
  });

  test('returns undefined for an absent field', () => {
    expect(extractModalField(fakeFields({}), 'missing')).toBeUndefined();
  });

  test('returns undefined for an empty select', () => {
    expect(extractModalField(fakeFields({ role: { values: [] } }), 'role')).toBeUndefined();
  });

  test('does NOT stringify a checkbox boolean (the footgun) — returns undefined', () => {
    // Before the fix this returned "false" (truthy) for an unchecked box.
    expect(extractModalField(fakeFields({ flag: { value: false } }), 'flag')).toBeUndefined();
    expect(extractModalField(fakeFields({ flag: { value: true } }), 'flag')).toBeUndefined();
  });

  test('coerces a numeric value to string', () => {
    expect(extractModalField(fakeFields({ n: { value: 42 } }), 'n')).toBe('42');
  });
});

describe('extractModalBoolean', () => {
  test('reads a checked checkbox as true', () => {
    expect(extractModalBoolean(fakeFields({ flag: { value: true } }), 'flag')).toBe(true);
  });

  test('reads an unchecked checkbox as false', () => {
    expect(extractModalBoolean(fakeFields({ flag: { value: false } }), 'flag')).toBe(false);
  });

  test('returns the default when the field is absent', () => {
    expect(extractModalBoolean(fakeFields({}), 'flag')).toBe(false);
    expect(extractModalBoolean(fakeFields({}), 'flag', true)).toBe(true);
  });

  test('returns the default when value is null/undefined', () => {
    expect(extractModalBoolean(fakeFields({ flag: { value: null } }), 'flag', true)).toBe(true);
    expect(extractModalBoolean(fakeFields({ flag: {} }), 'flag', true)).toBe(true);
  });
});

// Issue #2: an unrecognized modal shape used to yield customId '' — a submit
// filter that never matches, so a silent 5-minute wait and a false timeout.
describe('showAndAwaitModal', () => {
  function fakeInteraction() {
    const submit = { customId: '', user: { id: 'u1' } };
    return {
      user: { id: 'u1' },
      showModal: jest.fn(async () => undefined),
      awaitModalSubmit: jest.fn(async (opts: { filter: (i: typeof submit) => boolean }) => {
        submit.customId = 'my_modal';
        if (!opts.filter(submit)) throw new Error('timeout');
        return submit;
      }),
    };
  }

  test('a modal with no custom_id throws before anything is shown', async () => {
    const interaction = fakeInteraction();
    await expect(showAndAwaitModal(interaction as never, { title: 'x', components: [] } as never)).rejects.toThrow(
      'no custom_id',
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test('matches the submission by custom_id for both ModalBuilder and raw modals', async () => {
    const builder = fakeInteraction();
    expect(await showAndAwaitModal(builder as never, new ModalBuilder().setCustomId('my_modal').setTitle('t'))).toEqual({
      customId: 'my_modal',
      user: { id: 'u1' },
    });

    const raw = fakeInteraction();
    expect(await showAndAwaitModal(raw as never, { custom_id: 'my_modal', title: 't', components: [] })).not.toBeNull();
    expect(raw.showModal).toHaveBeenCalledTimes(1);
  });
});
