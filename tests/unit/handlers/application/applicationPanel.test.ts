/**
 * Application panel (v3.16.32). One bad position emoji, a 26th active
 * position or long descriptions made Discord reject every edit of the panel,
 * and the commands still said it worked. The builder now repairs what it can
 * and updateApplicationMessage says whether the edit landed.
 *
 * updateApplicationMessage's repos are real Repository instances, so they are
 * stubbed on the prototype (lazyRepo caches the instance, not the methods).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { Client } from 'discord.js';
import { Repository } from 'typeorm';
import {
  buildApplicationMessage,
  panelEmoji,
  updateApplicationMessage,
} from '../../../../src/commands/handlers/application/applicationPosition';
import type { Position } from '../../../../src/typeorm/entities/application/Position';

const position = (id: number, overrides: Partial<Position> = {}) =>
  ({ id, title: `Position ${id}`, description: 'Help out.', emoji: '🛡️', ...overrides }) as Position;
const buttons = (components: ReturnType<typeof buildApplicationMessage>['components']) =>
  components.flatMap(row => row.toJSON().components) as { emoji?: { id?: string; name?: string } }[];

describe('panelEmoji', () => {
  test('keeps unicode (flags, keycaps, skin tones) and custom emoji', () => {
    for (const emoji of ['📝', '🛡️', '🇺🇸', '1️⃣', '👍🏽', '<:staff:123456789012345678>', '<a:wave:123456789012345678>'])
      expect(panelEmoji(emoji)).toBe(emoji);
  });

  test('falls back to 📝 for text Discord would reject', () => {
    for (const emoji of ['staff', '50%', ':staff:', '', null]) expect(panelEmoji(emoji)).toBe('📝');
  });
});

describe('buildApplicationMessage', () => {
  test('an invalid emoji falls back instead of breaking the panel', () => {
    const { content, components } = buildApplicationMessage([position(1, { emoji: 'staff' })]);
    expect(content).toContain('## 📝 __Position 1__');
    expect(buttons(components)[0].emoji).toMatchObject({ name: '📝' });
  });

  test('shows at most 25 positions (5 rows of 5 buttons) and reports the rest', () => {
    const positions = Array.from({ length: 30 }, (_, i) => position(i + 1));
    const { content, components, hidden } = buildApplicationMessage(positions);
    expect(components).toHaveLength(5);
    expect(buttons(components)).toHaveLength(25);
    expect(hidden).toBe(5);
    expect(content).toContain('__Position 25__');
    expect(content).not.toContain('__Position 26__');
  });

  test('long descriptions are shortened to keep the panel within 2000 characters', () => {
    const positions = [
      position(1, { description: 'Short and whole.' }),
      position(2, { description: 'a'.repeat(1900) }),
      position(3, { description: 'b'.repeat(1900) }),
    ];
    const { content } = buildApplicationMessage(positions);
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain('Short and whole.');
    for (const id of [1, 2, 3]) expect(content).toContain(`__Position ${id}__`);
    expect(content).toContain('a…');
    expect(content).toContain('b…');
  });

  test('a normal panel is unchanged', () => {
    const { content, hidden } = buildApplicationMessage([position(1), position(2, { emoji: null })]);
    expect(hidden).toBe(0);
    expect(content).toContain('## 🛡️ __Position 1__\nHelp out.\n\n## 📝 __Position 2__\nHelp out.\n\n');
  });
});

describe('updateApplicationMessage', () => {
  let findOneBy: ReturnType<typeof jest.spyOn>;
  let find: ReturnType<typeof jest.spyOn>;
  const edit = jest.fn(async () => ({}));
  const client = {
    channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => ({ edit }) } }) },
  } as unknown as Client;

  beforeEach(() => {
    edit.mockClear();
    findOneBy = jest
      .spyOn(Repository.prototype, 'findOneBy')
      .mockResolvedValue({ guildId: 'g1', channelId: 'c1', messageId: 'm1' } as never);
    find = jest.spyOn(Repository.prototype, 'find').mockResolvedValue([position(1)] as never);
  });

  afterEach(() => {
    findOneBy.mockRestore();
    find.mockRestore();
  });

  test('updated, and no-panel when the panel was never set up', async () => {
    expect(await updateApplicationMessage(client, 'g1')).toBe('updated');
    expect(edit).toHaveBeenCalledTimes(1);
    findOneBy.mockResolvedValue(null as never);
    expect(await updateApplicationMessage(client, 'g1')).toBe('no-panel');
  });

  test('failed when Discord rejects the edit', async () => {
    edit.mockRejectedValueOnce(new Error('Invalid Form Body'));
    expect(await updateApplicationMessage(client, 'g1')).toBe('failed');
  });

  test('truncated when more than 25 positions are active', async () => {
    find.mockResolvedValue(Array.from({ length: 26 }, (_, i) => position(i + 1)) as never);
    expect(await updateApplicationMessage(client, 'g1')).toBe('truncated');
  });
});
