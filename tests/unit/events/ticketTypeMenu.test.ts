/**
 * Ticket type select menu (src/events/ticket/index.ts): Discord rejects the
 * whole menu for one invalid emoji or a 26th option, which used to drop every
 * member onto the legacy buttons. ticketInteraction.test.ts mocks this module
 * but spreads the real exports, so these pure helpers stay real.
 */
import { describe, expect, test } from 'bun:test';
import { buildTicketTypeOptions, isComponentEmoji } from '../../../src/events/ticket/index';

function type(i: number, emoji: string | null = '🎫') {
  return { typeId: `type_${i}`, displayName: `Type ${i}`, description: null, emoji } as never;
}

describe('isComponentEmoji', () => {
  test.each([
    '🎫',
    '❤️',
    '👍🏽',
    '🇺🇸',
    '1️⃣',
    '👩‍💻',
    '🏳️‍🌈',
    '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    '<:ticket:123456789012345678>',
    '<a:spin:123456789012345678>',
  ])('accepts %s', emoji => {
    expect(isComponentEmoji(emoji)).toBe(true);
  });

  test.each([':ticket:', 'bug', '', '🎫🎫', '<:ticket:>', '123', '🎫 help'])('rejects %p', emoji => {
    expect(isComponentEmoji(emoji)).toBe(false);
  });

  test('rejects null and undefined', () => {
    expect(isComponentEmoji(null)).toBe(false);
    expect(isComponentEmoji(undefined)).toBe(false);
  });
});

describe('buildTicketTypeOptions', () => {
  test('caps the menu at 25 options', () => {
    const options = buildTicketTypeOptions(Array.from({ length: 30 }, (_, i) => type(i)));
    expect(options).toHaveLength(25);
    expect(options[24].toJSON().value).toBe('type_24');
  });

  test('replaces an invalid emoji with the default instead of hiding the type', () => {
    const [bad, good] = buildTicketTypeOptions([type(1, ':bug:'), type(2, '🐛')]).map(o => o.toJSON());
    expect(bad.value).toBe('type_1');
    expect(bad.emoji).toEqual({ name: '🎫', id: undefined, animated: false });
    expect(good.emoji?.name).toBe('🐛');
  });

  test('clamps a 99-character name plus emoji without leaving a lone surrogate', () => {
    const long = { ...(type(1) as object), displayName: `${'a'.repeat(99)}🎫`, description: `${'d'.repeat(99)}🎫` };
    const [option] = buildTicketTypeOptions([long as never]).map(o => o.toJSON());
    expect(option.label).toBe(`${'a'.repeat(99)}…`);
    expect(option.description).toBe(`${'d'.repeat(99)}…`);
  });

  test('keeps a custom emoji', () => {
    const [option] = buildTicketTypeOptions([type(1, '<a:spin:123456789012345678>')]).map(o => o.toJSON());
    expect(option.emoji).toEqual({ name: 'spin', id: '123456789012345678', animated: true });
  });
});
