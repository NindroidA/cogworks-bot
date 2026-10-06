/**
 * Command audit log (NindroidA/cogworks-bot#41, finding #138).
 *
 * Before: the dispatcher wrote `command:<name>` for every auditable command
 * that returned, including the "not configured" reply and runs a guard
 * denied, so a cancelled or refused /bot-reset looked like a reset in the
 * audit view. Now the not-configured reply isn't audited, and bot-reset /
 * data-export write their own row only when the action happens.
 *
 * writeAuditLog is replaced with mock.module (same exports as the
 * ticketHandlers suite); the BotConfig lookup goes through the
 * AppDataSource.getRepository runtime patch, restored in afterAll.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { AppDataSource } from '../../../src/typeorm';

const fakeWriteAuditLog = jest.fn(async () => undefined);
mock.module('../../../src/utils/api/handlers/auditHelper', () => ({
  writeAuditLog: fakeWriteAuditLog,
  writeAuditAction: jest.fn(async () => undefined),
}));

type GetRepository = (entity: unknown) => unknown;

const configured = new Set<string>();
const botConfigRepo = {
  findOneBy: async ({ guildId }: { guildId: string }) => (configured.has(guildId) ? { guildId } : null),
};

let handleSlashCommand: typeof import('../../../src/commands/commands').handleSlashCommand;
let original: GetRepository;

beforeAll(async () => {
  const ds = AppDataSource as unknown as { getRepository: GetRepository };
  original = ds.getRepository;
  ds.getRepository = (entity: any) => {
    if (entity?.name === 'BotConfig') return botConfigRepo;
    throw new Error(`command audit test: no fake repo for ${entity?.name}`);
  };
  ({ handleSlashCommand } = await import('../../../src/commands/commands'));
});
afterAll(() => {
  (AppDataSource as unknown as { getRepository: GetRepository }).getRepository = original;
});

let seq = 0;
beforeEach(() => {
  fakeWriteAuditLog.mockClear();
});

function makeInteraction(commandName: string, opts: { admin?: boolean; subcommand?: string } = {}) {
  const guildId = `3000000000000${String(++seq).padStart(5, '0')}`;
  const interaction: any = {
    commandName,
    guildId,
    guild: { id: guildId, name: 'Test' },
    user: { id: `40000000000000${String(seq).padStart(4, '0')}`, username: 'admin' },
    member: { permissions: { has: () => opts.admin ?? true } },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    reply: jest.fn(async () => {
      interaction.replied = true;
    }),
    editReply: jest.fn(async () => undefined),
    followUp: jest.fn(async () => undefined),
    options: {
      getSubcommand: () => opts.subcommand ?? 'status',
      getSubcommandGroup: () => null,
    },
  };
  return { interaction, guildId };
}

describe('command audit log', () => {
  test('a command that ran is audited', async () => {
    const { interaction, guildId } = makeInteraction('import');
    configured.add(guildId);

    await handleSlashCommand({} as any, interaction);

    expect(fakeWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(fakeWriteAuditLog.mock.calls[0]).toEqual([guildId, 'command:import', interaction.user.id, {}, 'command'] as any);
  });

  test('the "not configured" reply is not audited', async () => {
    const { interaction } = makeInteraction('import');

    await handleSlashCommand({} as any, interaction);

    expect(interaction.reply).toHaveBeenCalled();
    expect(fakeWriteAuditLog).not.toHaveBeenCalled();
  });

  test('a /bot-reset the guard refused is not audited', async () => {
    const { interaction } = makeInteraction('bot-reset', { admin: false });

    await handleSlashCommand({} as any, interaction);

    expect(interaction.reply).toHaveBeenCalled();
    expect(fakeWriteAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// /bot-reset writes its own row (dispatcher no longer audits it)
// ---------------------------------------------------------------------------

describe('/bot-reset audit row', () => {
  const client = { baitChannelManager: { clearConfigCache() {}, clearKeywordCache() {} } } as any;

  function resetInteraction(clicks: string[]) {
    const guildId = `3000000000000${String(++seq).padStart(5, '0')}`;
    const message = {
      awaitMessageComponent: async () => {
        const customId = clicks.shift();
        if (!customId) throw new Error('time');
        return { customId, update: async () => undefined };
      },
    };
    const interaction: any = {
      guildId,
      guild: { name: 'Test' },
      commandName: 'bot-reset',
      createdTimestamp: Date.now(),
      member: { permissions: { has: () => true } },
      user: { id: 'admin-1', tag: 'admin#0001', send: async () => undefined },
      isRepliable: () => true,
      reply: async () => ({ resource: { message } }),
      editReply: async () => undefined,
    };
    return { interaction, guildId };
  }

  function deps(opts: { cleanupThrows?: boolean } = {}) {
    return {
      compileGuildArchive: async () => {
        throw new Error('not used: "No, Delete Everything"');
      },
      cleanupGuildMessages: async () => {
        if (opts.cleanupThrows) throw new Error('Missing Access');
        return { deleted: 0, failed: 0, details: [], keptChannelIds: [] };
      },
      deleteAllGuildData: async () => ({ success: true, total: 1, tables: 1, details: {}, failed: [] }),
      registerGuildCommands: async () => undefined,
    } as any;
  }

  const CONFIRM = ['reset_continue', 'reset_save_no', 'reset_confirm_final'];

  test('a finished reset writes one row', async () => {
    const { botResetHandler } = await import('../../../src/commands/handlers/botReset');
    const { interaction, guildId } = resetInteraction([...CONFIRM]);
    await botResetHandler(client, interaction, deps());
    expect(fakeWriteAuditLog.mock.calls).toEqual([
      [guildId, 'command:bot-reset', 'admin-1', { complete: true }, 'command'],
    ] as any);
  });

  test('an error after deletion started still writes the row, marked incomplete', async () => {
    const { botResetHandler } = await import('../../../src/commands/handlers/botReset');
    const { interaction, guildId } = resetInteraction([...CONFIRM]);
    await botResetHandler(client, interaction, deps({ cleanupThrows: true }));
    expect(fakeWriteAuditLog.mock.calls).toEqual([
      [guildId, 'command:bot-reset', 'admin-1', { complete: false }, 'command'],
    ] as any);
  });

  test('Cancel writes nothing', async () => {
    const { botResetHandler } = await import('../../../src/commands/handlers/botReset');
    const { interaction } = resetInteraction(['reset_cancel']);
    await botResetHandler(client, interaction, deps());
    expect(fakeWriteAuditLog).not.toHaveBeenCalled();
  });
});
