/**
 * Ticket restriction modals and the single-type toggle (v3.16.31).
 *
 * The restriction modals (/ticket manage user-restrict and the Manage
 * Restrictions context menu) listed only the first 10 types but diffed the
 * submission against ALL of the user's restrictions, so saving silently lifted
 * every restriction on type 11 and later. They now show up to 50 types in
 * groups of 10 and only add or lift restrictions on the types they showed.
 *
 * The single-type toggle listened to every button in the channel and replied
 * "not your interaction" to other members' clicks (the ticket panel too). It
 * now waits on its own reply.
 */

import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test';
import {
  buildRestrictionGroups,
  diffRestrictionSubmit,
  restrictionModalTitle,
  userRestrictHandler,
} from '../../../../src/commands/handlers/ticket/userRestrict';
import { AppDataSource } from '../../../../src/typeorm';
import type { CustomTicketType } from '../../../../src/typeorm/entities/ticket/CustomTicketType';

const GUILD = 'guild-user-restrict';
const types = Array.from(
  { length: 55 },
  (_, i) => ({ guildId: GUILD, typeId: `type_${i + 1}`, displayName: `Type ${i + 1}`, emoji: null }) as unknown as CustomTicketType,
);

/** A ModalSubmitFields fake: getField throws for ids the submission doesn't carry, like discord.js. */
function fields(groups: Record<string, string[]>) {
  return {
    getField: (id: string) => {
      if (!(id in groups)) throw new Error(`no field ${id}`);
      return { values: groups[id] };
    },
  } as never;
}

describe('buildRestrictionGroups', () => {
  test('splits types into checkbox groups of 10, at most 5 groups (50 types)', () => {
    const { components, shownIds } = buildRestrictionGroups(types, new Set(['type_12']), 'ur');

    expect(components).toHaveLength(5);
    expect(shownIds.size).toBe(50);
    expect(shownIds.has('type_51')).toBe(false);
    const second = components[1].component as unknown as { custom_id: string; options: { value: string; default: boolean }[] };
    expect(second.custom_id).toBe('ur_1');
    expect(second.options.map(o => o.value)).toEqual(Array.from({ length: 10 }, (_, i) => `type_${i + 11}`));
    expect(second.options.find(o => o.value === 'type_12')?.default).toBe(true);
  });

  test('a guild with 3 types gets one group', () => {
    const { components, shownIds } = buildRestrictionGroups(types.slice(0, 3), new Set(), 'ur');
    expect(components).toHaveLength(1);
    expect([...shownIds]).toEqual(['type_1', 'type_2', 'type_3']);
  });
});

describe('diffRestrictionSubmit', () => {
  const { shownIds } = buildRestrictionGroups(types, new Set(), 'ur');

  test('keeps a restriction on a type the modal could not show', () => {
    const stored = new Set(['type_52', 'type_3']);
    const result = diffRestrictionSubmit(fields({ ur_0: ['type_3', 'type_4'] }), 'ur', shownIds, stored);

    expect(result.toAdd).toEqual(['type_4']);
    expect(result.toRemove).toEqual([]);
    expect([...result.restricted].sort()).toEqual(['type_3', 'type_4', 'type_52']);
  });

  test('reads every group and lifts restrictions that were unchecked', () => {
    const stored = new Set(['type_12', 'type_45']);
    const result = diffRestrictionSubmit(fields({ ur_1: ['type_15'], ur_4: [] }), 'ur', shownIds, stored);

    expect(result.toAdd).toEqual(['type_15']);
    expect(result.toRemove.sort()).toEqual(['type_12', 'type_45']);
    expect([...result.restricted]).toEqual(['type_15']);
  });

  test('ignores ids the modal did not offer', () => {
    const result = diffRestrictionSubmit(fields({ ur_0: ['type_53', 'other-guild-type'] }), 'ur', shownIds, new Set());
    expect(result.toAdd).toEqual([]);
  });
});

test('restrictionModalTitle stays within the 45-character modal title limit', () => {
  expect(restrictionModalTitle('A'.repeat(32))).toHaveLength(45);
  expect(restrictionModalTitle('Sam')).toBe('Restrictions: Sam');
});

describe('single-type toggle', () => {
  const restrictionRepo = {
    findOne: jest.fn(async () => null),
    create: jest.fn((row: object) => row),
    save: jest.fn(async (row: object) => row),
  };
  type RepoGetter = { getRepository: (entity: { name?: string }) => unknown };
  let originalGetRepository: RepoGetter['getRepository'];

  beforeAll(() => {
    originalGetRepository = (AppDataSource as unknown as RepoGetter).getRepository;
    (AppDataSource as unknown as RepoGetter).getRepository = entity => {
      if (entity?.name === 'CustomTicketType') return { find: async () => types.slice(0, 3) };
      if (entity?.name === 'UserTicketRestriction') return restrictionRepo;
      throw new Error(`userRestrict test: unexpected repo ${entity?.name}`);
    };
  });

  afterAll(() => {
    (AppDataSource as unknown as RepoGetter).getRepository = originalGetRepository;
  });

  test('waits on its own reply, not the channel, and saves the restriction on Restrict', async () => {
    const button = { customId: '', update: jest.fn(async () => undefined), editReply: jest.fn(async () => undefined) };
    const awaitMessageComponent = jest.fn(async (opts: { filter: (i: unknown) => boolean }) => {
      // Another member's panel click never reaches this prompt
      expect(opts.filter({ user: { id: 'member-9' }, customId: 'ticket_create' })).toBe(false);
      button.customId = 'ur_toggle_interaction-7_yes';
      return button;
    });
    const target = { id: 'user-5', tag: 'spammer', displayName: 'spammer', toString: () => '<@user-5>' };
    const interaction = {
      id: 'interaction-7',
      guildId: GUILD,
      guild: {},
      user: { id: 'mod-1' },
      member: { permissions: { has: () => true } },
      options: { getUser: () => target, getString: () => 'type_2' },
      deferred: false,
      replied: false,
      isRepliable: () => true,
      reply: jest.fn(async () => ({ awaitMessageComponent })),
      editReply: jest.fn(async () => undefined),
      channel: {
        createMessageComponentCollector: jest.fn(() => {
          throw new Error('channel-wide collector used');
        }),
      },
    };

    await userRestrictHandler(interaction as never);

    expect(interaction.channel.createMessageComponentCollector).not.toHaveBeenCalled();
    expect(restrictionRepo.save).toHaveBeenCalledWith({
      guildId: GUILD,
      userId: 'user-5',
      typeId: 'type_2',
      restrictedBy: 'mod-1',
    });
    expect(button.editReply).toHaveBeenCalledTimes(1);
  });
});
