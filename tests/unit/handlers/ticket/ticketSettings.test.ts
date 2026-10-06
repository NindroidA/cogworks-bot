/**
 * /ticket manage settings ping-on-create and /ticket workflow settings (v3.16.31).
 *
 * ping-on-create: every builtin id (ban_appeal, bug_report, ...) gets a seeded
 * CustomTicketType row, and ticket creation reads that row's pingStaffOnCreate.
 * The handler wrote the old TicketConfig.pingStaffOn* column instead and
 * reported success, so the setting did nothing. The TicketConfig column is
 * now only the fallback for a builtin id with no row.
 *
 * workflow settings: the modal saved the TicketConfig loaded before it opened
 * (up to 5 minutes earlier), reverting changes made meanwhile. It now applies
 * the two flags to a fresh read.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { settingsHandler } from '../../../../src/commands/handlers/ticket/settings';
import { workflowSettingsHandler } from '../../../../src/commands/handlers/ticket/workflowSettings';
import { AppDataSource } from '../../../../src/typeorm';

const GUILD = 'guild-ticket-settings';

let customTypeRow: Record<string, unknown> | null = null;
const customTypeRepo = {
  findOneBy: jest.fn(async () => customTypeRow),
  update: jest.fn(async () => ({ affected: 1 })),
};
// Successive TicketConfig reads, oldest first; the last one repeats.
let configReads: Record<string, unknown>[] = [];
const ticketConfigRepo = {
  findOneBy: jest.fn(async () => (configReads.length > 1 ? configReads.shift() : configReads[0]) ?? null),
  update: jest.fn(async () => ({ affected: 1 })),
  save: jest.fn(async (row: object) => row),
};

type RepoGetter = { getRepository: (entity: { name?: string }) => unknown };
let originalGetRepository: RepoGetter['getRepository'];

beforeAll(() => {
  originalGetRepository = (AppDataSource as unknown as RepoGetter).getRepository;
  // Stable objects: workflowSettings caches its repo through lazyRepo.
  (AppDataSource as unknown as RepoGetter).getRepository = entity => {
    if (entity?.name === 'CustomTicketType') return customTypeRepo;
    if (entity?.name === 'TicketConfig') return ticketConfigRepo;
    throw new Error(`ticketSettings test: unexpected repo ${entity?.name}`);
  };
});

afterAll(() => {
  (AppDataSource as unknown as RepoGetter).getRepository = originalGetRepository;
});

beforeEach(() => {
  customTypeRepo.update.mockClear();
  ticketConfigRepo.update.mockClear();
  ticketConfigRepo.save.mockClear();
});

function baseInteraction(extra: Record<string, unknown>) {
  return {
    guildId: GUILD,
    guild: {},
    user: { id: 'admin-1' },
    member: { permissions: { has: () => true } },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    reply: jest.fn(async () => undefined),
    ...extra,
  };
}

function settingsInteraction(typeId: string) {
  return baseInteraction({
    options: {
      getString: (name: string) => (name === 'setting' ? 'ping-on-create' : typeId),
      getBoolean: () => true,
    },
  });
}

describe('ping-on-create', () => {
  test('a builtin id with a seeded row updates the row ticket creation reads', async () => {
    configReads = [{ guildId: GUILD }];
    customTypeRow = { guildId: GUILD, typeId: 'ban_appeal', displayName: 'Ban Appeal (custom)' };
    const interaction = settingsInteraction('ban_appeal');

    await settingsHandler(interaction as never);

    expect(customTypeRepo.update).toHaveBeenCalledWith(
      { guildId: GUILD, typeId: 'ban_appeal' },
      { pingStaffOnCreate: true },
    );
    expect(ticketConfigRepo.update).not.toHaveBeenCalled();
    const embed = (interaction.reply.mock.calls[0] as unknown as [{ embeds: { data: { description: string } }[] }])[0]
      .embeds[0];
    expect(embed.data.description).toContain('Ban Appeal (custom)');
  });

  test('a builtin id with no row falls back to the TicketConfig column', async () => {
    configReads = [{ guildId: GUILD }];
    customTypeRow = null;

    await settingsHandler(settingsInteraction('ban_appeal') as never);

    expect(customTypeRepo.update).not.toHaveBeenCalled();
    expect(ticketConfigRepo.update).toHaveBeenCalledWith({ guildId: GUILD }, { pingStaffOnBanAppeal: true });
  });

  test('an unknown id is refused', async () => {
    configReads = [{ guildId: GUILD }];
    customTypeRow = null;
    const interaction = settingsInteraction('nope');

    await settingsHandler(interaction as never);

    expect(customTypeRepo.update).not.toHaveBeenCalled();
    expect(ticketConfigRepo.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });
});

describe('workflow settings modal', () => {
  test('applies the two flags to the config read after the modal, not the one read before', async () => {
    configReads = [
      { guildId: GUILD, enableWorkflow: false, autoCloseEnabled: false, categoryId: 'old-category' },
      {
        guildId: GUILD,
        enableWorkflow: false,
        autoCloseEnabled: false,
        categoryId: 'new-category',
        workflowStatuses: [{ id: 'open' }],
        autoCloseDays: 7,
      },
    ];
    const submit = {
      fields: { getField: (id: string) => ({ value: id === 'wf_enable' || id === 'wf_autoclose' }) },
      reply: jest.fn(async () => undefined),
    };
    const interaction = baseInteraction({
      showModal: jest.fn(async () => undefined),
      awaitModalSubmit: jest.fn(async () => submit),
    });

    await workflowSettingsHandler(interaction as never);

    expect(ticketConfigRepo.save).toHaveBeenCalledTimes(1);
    const saved = (ticketConfigRepo.save.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(saved.categoryId).toBe('new-category');
    expect(saved.enableWorkflow).toBe(true);
    expect(saved.autoCloseEnabled).toBe(true);
    expect(submit.reply).toHaveBeenCalledTimes(1);
  });
});
