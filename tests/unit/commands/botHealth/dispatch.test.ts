/**
 * `/bot-health` registration and dispatch: always visible (never module-gated),
 * admin-default and guild-only, and it runs on a server with no BotConfig row,
 * where every other non-setup command stops at "run /bot-setup first".
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PermissionsBitField } from 'discord.js';
import { botHealth, HEALTH_SYSTEM_CHOICES } from '../../../../src/commands/builders/botHealth';
import { commands } from '../../../../src/commands/commandList';
import { lang } from '../../../../src/lang';
import { DEFAULT_SYSTEM_STATES } from '../../../../src/typeorm/entities/SetupState';
import { isCommandVisible } from '../../../../src/utils/setup/commandGating';
import { makeFakeGuild } from '../../../helpers/fakeGuild';

const G = '100000000000000001';

describe('/bot-health builder', () => {
  const json = botHealth as any;

  test('admin by default, guild only, one `check` subcommand', () => {
    expect(json.name).toBe('bot-health');
    expect(json.default_member_permissions).toBe(String(PermissionsBitField.Flags.Administrator));
    expect(json.dm_permission).toBe(false);
    expect(json.options.map((o: { name: string }) => o.name)).toEqual(['check']);
  });

  test('check options: system (all, core, every /bot-setup system but staff roles, XP, starboard, onboarding), deep, owner-only guild-id', () => {
    const [check] = json.options;
    expect(check.options.map((o: { name: string }) => o.name)).toEqual(['system', 'deep', 'guild-id']);
    const values = check.options[0].choices.map((c: { value: string }) => c.value);
    expect(values).toEqual([
      'all',
      'core',
      ...Object.keys(DEFAULT_SYSTEM_STATES).filter(s => s !== 'staffRole'),
      'xp',
      'starboard',
      'onboarding',
    ]);
    expect(HEALTH_SYSTEM_CHOICES).toEqual(values.slice(1));
    for (const choice of check.options[0].choices) expect(choice.name).not.toBe(choice.value);
    expect(check.options[2].min_length).toBe(17);
    expect(check.options[2].max_length).toBe(20);
  });

  test('registered and never hidden by module gating', () => {
    const names = commands.map(c => (c as { toJSON?: () => { name: string } }).toJSON?.().name ?? (c as any).name);
    expect(names).toContain('bot-health');
    expect(isCommandVisible('bot-health', new Set())).toBe(true);
  });
});

describe('dispatch without a BotConfig', () => {
  const botConfigLookups: unknown[] = [];
  const fakeRepo = {
    findOneBy: async (where: unknown) => {
      botConfigLookups.push(where);
      return null;
    },
    findOne: async () => null,
    find: async () => [],
    create: (row: unknown) => row,
    save: async (row: unknown) => row,
  };
  let originalGetRepository: unknown;
  let handleSlashCommand: typeof import('../../../../src/commands/commands').handleSlashCommand;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../../../src/typeorm');
    const ds = AppDataSource as unknown as { getRepository: unknown };
    originalGetRepository = ds.getRepository;
    ds.getRepository = () => fakeRepo;
    handleSlashCommand = (await import('../../../../src/commands/commands')).handleSlashCommand;
  });

  afterAll(async () => {
    const { AppDataSource } = await import('../../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: unknown }).getRepository = originalGetRepository;
  });

  function interaction(commandName: string) {
    const replies: { content?: string }[] = [];
    const guild = makeFakeGuild({ id: G });
    return {
      replies,
      value: {
        commandName,
        user: { id: '400000000000000003', username: 'member', tag: 'member' },
        guildId: G,
        guild,
        // Not an admin, so /bot-health stops at its own guard with a visible reply.
        member: { permissions: new PermissionsBitField([]) },
        deferred: false,
        replied: false,
        isRepliable: () => true,
        options: { getSubcommand: () => 'check', getString: () => null, getBoolean: () => null },
        async reply(payload: { content?: string }) {
          replies.push(payload);
        },
      },
    };
  }

  test('/bot-health reaches its own handler instead of the "not set up" stop', async () => {
    const { value, replies } = interaction('bot-health');
    botConfigLookups.length = 0;
    await handleSlashCommand({} as never, value as never);
    expect(botConfigLookups).toEqual([]);
    expect(replies.map(r => r.content).join('\n')).toContain('Administrator');
    expect(replies.map(r => r.content).join('\n')).not.toContain(lang.botConfig.notFound);
  });

  test('a regular command still stops at the BotConfig check', async () => {
    const { value, replies } = interaction('ping');
    botConfigLookups.length = 0;
    await handleSlashCommand({} as never, value as never);
    expect(botConfigLookups).toEqual([{ guildId: G }]);
    expect(replies.map(r => r.content).join('\n')).toContain(lang.botConfig.notFound);
  });
});
