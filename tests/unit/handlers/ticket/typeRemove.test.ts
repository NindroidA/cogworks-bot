/**
 * /ticket type remove confirmation (v3.16.31).
 *
 * The handler used a channel-wide collector filtered only by user, with the
 * shared customId 'confirm_delete'. A second remove prompt's Delete click also
 * deleted the first type, and any other button the admin pressed in the
 * channel (the ticket panel included) was treated as Cancel and overwritten.
 * It now waits on its own reply through awaitConfirmation with a per-prompt
 * customId prefix, and also clears restrictions on the deleted type.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { typeRemoveHandler } from '../../../../src/commands/handlers/ticket/typeRemove';
import { AppDataSource } from '../../../../src/typeorm';

const GUILD = 'guild-type-remove';
const ticketType = { guildId: GUILD, typeId: 'partnership', displayName: 'Partnership' };

const typeRepo = {
  findOne: jest.fn(async () => ticketType),
  remove: jest.fn(async () => ticketType),
};
const restrictionRepo = { delete: jest.fn(async () => ({ affected: 2 })) };

type RepoGetter = { getRepository: (entity: { name?: string }) => unknown };
let originalGetRepository: RepoGetter['getRepository'];

beforeAll(() => {
  originalGetRepository = (AppDataSource as unknown as RepoGetter).getRepository;
  (AppDataSource as unknown as RepoGetter).getRepository = entity => {
    if (entity?.name === 'CustomTicketType') return typeRepo;
    if (entity?.name === 'UserTicketRestriction') return restrictionRepo;
    throw new Error(`typeRemove test: unexpected repo ${entity?.name}`);
  };
});

afterAll(() => {
  (AppDataSource as unknown as RepoGetter).getRepository = originalGetRepository;
});

beforeEach(() => {
  typeRepo.remove.mockClear();
  restrictionRepo.delete.mockClear();
});

/** A slash interaction whose reply resolves a click on that reply only. */
function makeInteraction(click: (prefixFilter: (i: { user: { id: string }; customId: string }) => boolean) => string) {
  const button = {
    customId: '',
    update: jest.fn(async () => undefined),
    editReply: jest.fn(async () => undefined),
  };
  const awaitMessageComponent = jest.fn(async (opts: { filter: (i: never) => boolean }) => {
    button.customId = click(opts.filter as never);
    return button;
  });
  const interaction = {
    id: 'interaction-1',
    guildId: GUILD,
    guild: {},
    user: { id: 'admin-1' },
    member: { permissions: { has: () => true } },
    options: { getString: () => 'partnership' },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    reply: jest.fn(async () => ({ awaitMessageComponent })),
    editReply: jest.fn(async () => undefined),
    // The old code listened here; it must not any more.
    channel: {
      createMessageComponentCollector: jest.fn(() => {
        throw new Error('channel-wide collector used');
      }),
    },
  };
  return { interaction, button, awaitMessageComponent };
}

describe('typeRemoveHandler', () => {
  test('waits on its own reply with a per-prompt id, and ignores other prompts and the panel', async () => {
    const { interaction, button, awaitMessageComponent } = makeInteraction(filter => {
      // Another prompt's Delete, the panel's button and another member are all rejected
      expect(filter({ user: { id: 'admin-1' }, customId: 'confirm_delete' })).toBe(false);
      expect(filter({ user: { id: 'admin-1' }, customId: 'create_ticket' })).toBe(false);
      expect(filter({ user: { id: 'admin-1' }, customId: 'tt_remove_other-interaction_yes' })).toBe(false);
      expect(filter({ user: { id: 'someone-else' }, customId: 'tt_remove_interaction-1_yes' })).toBe(false);
      expect(filter({ user: { id: 'admin-1' }, customId: 'tt_remove_interaction-1_yes' })).toBe(true);
      return 'tt_remove_interaction-1_yes';
    });

    await typeRemoveHandler(interaction as never);

    expect(awaitMessageComponent).toHaveBeenCalledTimes(1);
    expect(interaction.channel.createMessageComponentCollector).not.toHaveBeenCalled();
    expect(typeRepo.remove).toHaveBeenCalledWith(ticketType);
    expect(restrictionRepo.delete).toHaveBeenCalledWith({ guildId: GUILD, typeId: 'partnership' });
    expect(button.editReply).toHaveBeenCalledWith({
      content: 'Ticket type **Partnership** has been deleted!',
      components: [],
    });
  });

  test('Cancel deletes nothing', async () => {
    const { interaction } = makeInteraction(() => 'tt_remove_interaction-1_no');

    await typeRemoveHandler(interaction as never);

    expect(typeRepo.remove).not.toHaveBeenCalled();
    expect(restrictionRepo.delete).not.toHaveBeenCalled();
  });
});
