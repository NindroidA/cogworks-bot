/**
 * Slash-command sync check: the guild's registered commands (as Discord returns
 * them, wrapped in real discord.js `ApplicationCommand`s) against the expected
 * set from the real command builders.
 */
import { describe, expect, test } from 'bun:test';
import { ApplicationCommand, type Guild } from 'discord.js';
import { commands } from '../../../../src/commands/commandList';
import { createCommandSyncCheck, guildCommandMatches } from '../../../../src/utils/health/checks/commands';
import { createRestFetcher } from '../../../../src/utils/health/context';
import { runCheck } from '../../../../src/utils/health/runner';
import { FAKE_BOT_ID, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

type Json = Record<string, any>;

const toJson = (cmd: unknown): Json => {
  const maybe = cmd as { toJSON?: () => Json };
  return typeof maybe.toJSON === 'function' ? maybe.toJSON() : (cmd as Json);
};

/** What Discord returns for a registered guild command: no dm_permission, required:false omitted, extra defaults. */
function discordShape(json: Json, i: number): Json {
  const api: Json = JSON.parse(JSON.stringify(json));
  delete api.dm_permission;
  const strip = (options: Json[] | undefined) => {
    for (const option of options ?? []) {
      if (option.required === false) delete option.required;
      strip(option.options);
    }
  };
  strip(api.options);
  return {
    ...api,
    id: String(300000000000000000n + BigInt(i)),
    application_id: FAKE_BOT_ID,
    version: '1',
    description: api.description ?? '',
    default_member_permissions: api.default_member_permissions ?? null,
    nsfw: false,
    integration_types: [0],
    contexts: null,
  };
}

function registered(guild: Guild, jsons: Json[]): Map<string, ApplicationCommand> {
  const map = new Map<string, ApplicationCommand>();
  jsons.forEach((json, i) => {
    const command = new (ApplicationCommand as any)({}, discordShape(json, i), guild) as ApplicationCommand;
    map.set(command.id, command);
  });
  return map;
}

/** A context whose guild returns `jsons` (or throws `error`) from `commands.fetch`. */
function ctxWith(jsons: Json[], error?: { code: number }) {
  const guild = makeFakeGuild();
  const withCommands = {
    ...guild,
    commands: {
      fetch: async () => {
        if (error) throw error;
        return registered(guild, jsons);
      },
    },
  } as unknown as Guild;
  return makeCheckContext({ guild: withCommands });
}

const expected = commands.map(toJson);
const expectAll = async () => commands;
const check = createCommandSyncCheck(expectAll);

describe('core.commands', () => {
  test('in sync: every real command, as Discord returns it, matches its builder', async () => {
    expect(await check.run(ctxWith(expected))).toEqual([]);
  });

  test('guildCommandMatches ignores dm_permission, which Discord drops on guild commands', () => {
    const migrate = expected.find(c => c.name === 'migrate')!;
    expect(migrate.dm_permission).toBe(false);
    const [command] = registered(makeFakeGuild(), [migrate]).values();
    expect(command.dmPermission).toBeNull();
    expect(guildCommandMatches(command, JSON.parse(JSON.stringify(migrate)))).toBe(true);
  });

  test('missing: an expected command is not registered (degraded, auto)', async () => {
    const findings = await check.run(ctxWith(expected.filter(c => c.name !== 'migrate')));
    expect(findings).toEqual([
      {
        code: 'core.commands.missing',
        system: 'core',
        severity: 'degraded',
        repair: 'auto',
        entity: 'ApplicationCommand',
        params: { count: 1, names: '`migrate`' },
      },
    ]);
  });

  test('outdated: a registered command differs from its builder (degraded, auto)', async () => {
    const stale = expected.map(c => (c.name === 'ping' ? { ...c, description: 'Old description' } : c));
    const findings = await check.run(ctxWith(stale));
    expect(findings.map(f => [f.code, f.severity, f.repair, f.params.names])).toEqual([
      ['core.commands.outdated', 'degraded', 'auto', '`ping`'],
    ]);
  });

  test('outdated: a changed option is caught too', async () => {
    const stale = expected.map(c => (c.name === 'migrate' ? { ...c, options: c.options.slice(1) } : c));
    const findings = await check.run(ctxWith(stale));
    expect(findings.map(f => f.code)).toEqual(['core.commands.outdated']);
  });

  test('unexpected: a registered command the bot no longer offers here (cosmetic, auto)', async () => {
    const extra = { name: 'old-command', description: 'Gone', type: 1, options: [] };
    const findings = await check.run(ctxWith([...expected, extra]));
    expect(findings.map(f => [f.code, f.severity, f.repair, f.params.names])).toEqual([
      ['core.commands.unexpected', 'cosmetic', 'auto', '`old-command`'],
    ]);
  });

  test('a gated module turned off: its commands still registered read as unexpected', async () => {
    const gated = createCommandSyncCheck(async () => commands.filter(c => toJson(c).name !== 'memory'));
    const findings = await gated.run(ctxWith(expected));
    expect(findings.map(f => [f.code, f.params.names])).toEqual([['core.commands.unexpected', '`memory`']]);
  });

  test('a slash command and a context menu with the same name are told apart by type', async () => {
    const menu = { name: 'ping', type: 2, default_member_permissions: '8' };
    const findings = await check.run(ctxWith(expected.filter(c => c.name !== 'ping').concat(menu)));
    expect(findings.map(f => [f.code, f.params.names])).toEqual([
      ['core.commands.missing', '`ping`'],
      ['core.commands.unexpected', '`ping`'],
    ]);
  });

  test('long lists name the first 10 and count the rest', async () => {
    const findings = await check.run(ctxWith([]));
    expect(findings).toHaveLength(1);
    expect(findings[0].params.count).toBe(expected.length);
    expect(String(findings[0].params.names)).toEndWith(`+${expected.length - 10}`);
    expect(String(findings[0].params.names).split(', ')).toHaveLength(10);
  });

  test('50001: no applications.commands scope (block, manual) with the bot id for the invite link', async () => {
    const findings = await check.run(ctxWith(expected, { code: 50001 }));
    expect(findings).toEqual([
      {
        code: 'core.commands.no_scope',
        system: 'core',
        severity: 'block',
        repair: 'manual',
        entity: 'ApplicationCommand',
        params: { botId: FAKE_BOT_ID },
      },
    ]);
  });

  test('a 5xx proves nothing: the run reports core.commands.error, not drift', async () => {
    const result = await runCheck(check, ctxWith(expected, { code: 0 }));
    expect(result.findings.map(f => f.code)).toEqual(['core.commands.error']);
  });

  test('the expected set failing to load (DB down) is an error, not drift', async () => {
    const broken = createCommandSyncCheck(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await runCheck(broken, ctxWith(expected));
    expect(result.findings.map(f => f.code)).toEqual(['core.commands.error']);
  });

  test('over the REST budget: skipped and listed by the fetcher, no findings', async () => {
    const ctx = { ...ctxWith(expected), rest: createRestFetcher({ concurrency: 1, timeoutMs: 1_000, maxCalls: 0 }) };
    expect(await check.run(ctx)).toEqual([]);
    expect(ctx.rest.skipped).toEqual(['commands']);
  });
});
