/**
 * /ticket type list (v3.16.31).
 *
 * - Set as Default saved every row one by one from a shared array (issue #2);
 *   it is now two updates in one transaction, which /ticket type default
 *   also uses.
 * - The summary embed added one field per type with no cap, so 26 types (or a
 *   few long descriptions) broke Discord's 25-field / 6,000-character limits
 *   and the command failed. It now stops in time and says how many are hidden.
 */

import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test';
import { typeDefaultHandler } from '../../../../src/commands/handlers/ticket/typeDefault';
import { buildSummaryEmbed, setDefaultTicketType } from '../../../../src/commands/handlers/ticket/typeList';
import { AppDataSource } from '../../../../src/typeorm';
import type { CustomTicketType } from '../../../../src/typeorm/entities/ticket/CustomTicketType';

/** No lone surrogate (an emoji cut in half makes Discord reject the payload). */
const isWellFormed = (text: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe('setDefaultTicketType', () => {
  const updates: { entity: string; where: object; set: object }[] = [];
  type Tx = { transaction: (cb: (manager: unknown) => Promise<void>) => Promise<void> };
  let originalTransaction: Tx['transaction'];

  beforeAll(() => {
    originalTransaction = (AppDataSource as unknown as Tx).transaction;
    (AppDataSource as unknown as Tx).transaction = async cb =>
      cb({
        update: async (entity: { name: string }, where: object, set: object) => {
          updates.push({ entity: entity.name, where, set });
        },
      });
  });

  type RepoGetter = { getRepository: (entity: { name?: string }) => unknown };
  let originalGetRepository: RepoGetter['getRepository'];
  const typeRow = { guildId: 'g1', typeId: 'player_report', displayName: 'Player Report', isActive: true };

  beforeAll(() => {
    originalGetRepository = (AppDataSource as unknown as RepoGetter).getRepository;
    (AppDataSource as unknown as RepoGetter).getRepository = entity => {
      if (entity?.name === 'CustomTicketType') return { findOne: async () => typeRow };
      throw new Error(`typeList test: unexpected repo ${entity?.name}`);
    };
  });

  afterAll(() => {
    (AppDataSource as unknown as Tx).transaction = originalTransaction;
    (AppDataSource as unknown as RepoGetter).getRepository = originalGetRepository;
  });

  test('/ticket type default goes through the same transaction', async () => {
    updates.length = 0;
    const interaction = {
      guildId: 'g1',
      guild: {},
      user: { id: 'admin-1' },
      member: { permissions: { has: () => true } },
      options: { getString: () => 'player_report' },
      deferred: false,
      replied: false,
      isRepliable: () => true,
      reply: jest.fn(async () => undefined),
    };

    await typeDefaultHandler(interaction as never);

    expect(updates.map(u => u.where)).toEqual([
      { guildId: 'g1', isDefault: true },
      { guildId: 'g1', typeId: 'player_report' },
    ]);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  test('clears the old default and sets the new one in one transaction, scoped to the guild', async () => {
    updates.length = 0;
    await setDefaultTicketType('g1', 'bug_report');

    expect(updates).toEqual([
      { entity: 'CustomTicketType', where: { guildId: 'g1', isDefault: true }, set: { isDefault: false } },
      { entity: 'CustomTicketType', where: { guildId: 'g1', typeId: 'bug_report' }, set: { isDefault: true } },
    ]);
  });
});

describe('buildSummaryEmbed', () => {
  const makeTypes = (count: number, description: string | null) =>
    Array.from(
      { length: count },
      (_, i) =>
        ({
          typeId: `type_${i}`,
          displayName: `Ticket type number ${i}`,
          emoji: '🎫',
          description,
          isActive: true,
          isDefault: i === 0,
          pingStaffOnCreate: false,
        }) as unknown as CustomTicketType,
    );
  const embedChars = (json: ReturnType<ReturnType<typeof buildSummaryEmbed>['toJSON']>) =>
    (json.title?.length ?? 0) +
    (json.description?.length ?? 0) +
    (json.footer?.text.length ?? 0) +
    (json.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

  test('30 types: 25 fields and a footer for the other 5', () => {
    const json = buildSummaryEmbed(makeTypes(30, null)).toJSON();
    expect(json.fields).toHaveLength(25);
    expect(json.footer?.text).toContain('5 more');
  });

  test('long descriptions are shortened and the embed stays under 6,000 characters', () => {
    const json = buildSummaryEmbed(makeTypes(20, 'x'.repeat(500))).toJSON();
    expect(embedChars(json)).toBeLessThanOrEqual(6000);
    for (const field of json.fields ?? []) expect(field.value.length).toBeLessThan(300);
    expect((json.fields?.length ?? 0) + Number(json.footer?.text.match(/^\d+/)?.[0] ?? 0)).toBe(20);
  });

  test('long names and descriptions: stops before 6,000 characters and counts the rest', () => {
    const types = makeTypes(25, 'y'.repeat(500)).map(t => ({ ...t, displayName: 'N'.repeat(100) }) as CustomTicketType);
    const json = buildSummaryEmbed(types).toJSON();
    expect(embedChars(json)).toBeLessThanOrEqual(6000);
    const shown = json.fields?.length ?? 0;
    expect(shown).toBeLessThan(25);
    expect(json.footer?.text).toContain(`${25 - shown} more`);
  });

  test('an emoji at the name or description limit is never cut in half', () => {
    const [type] = makeTypes(1, `${'d'.repeat(98)}🙂🙂`);
    const json = buildSummaryEmbed([{ ...type, displayName: `${'N'.repeat(252)}🙂🙂` } as CustomTicketType]).toJSON();
    const field = json.fields?.[0];
    expect(field?.name.length).toBeLessThanOrEqual(256);
    expect(isWellFormed(field?.name ?? '')).toBe(true);
    expect(isWellFormed(field?.value ?? '')).toBe(true);
    expect(field?.value).toContain('…');
  });

  test('a few types: all shown, no footer', () => {
    const json = buildSummaryEmbed(makeTypes(3, 'short')).toJSON();
    expect(json.fields).toHaveLength(3);
    expect(json.footer).toBeUndefined();
  });
});
