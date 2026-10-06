/**
 * Slash-command sync check: the guild's registered commands (as Discord returns
 * them, wrapped in real discord.js `ApplicationCommand`s) against the expected
 * set from the real command builders.
 */
import { describe, expect, test } from 'bun:test';
import { ApplicationCommand, type Guild } from 'discord.js';
import { commands } from '../../../../src/commands/commandList';
import {
  alignUnsetOptions,
  createCommandSyncCheck,
  guildCommandMatches,
} from '../../../../src/utils/health/checks/commands';
import { createRestFetcher } from '../../../../src/utils/health/context';
import { runCheck } from '../../../../src/utils/health/runner';
import { FAKE_BOT_ID, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

type Json = Record<string, any>;

const toJson = (cmd: unknown): Json => {
  const maybe = cmd as { toJSON?: () => Json };
  return typeof maybe.toJSON === 'function' ? maybe.toJSON() : (cmd as Json);
};

/**
 * How Discord might echo a field the builders send empty or false. Its docs
 * don't say, so every check below runs against each shape.
 */
interface Shape {
  /** Leave out `options: []` on commands, subcommands and groups that take none. */
  dropEmptyOptions?: boolean;
  /** Write `autocomplete: false` and `required: false` instead of leaving them out. */
  explicitFalse?: boolean;
}

const SHAPES: [string, Shape][] = [
  ['empty options kept', {}],
  ['empty options left out', { dropEmptyOptions: true }],
  ['empty options left out, false defaults written out', { dropEmptyOptions: true, explicitFalse: true }],
];

/** Option types that take `autocomplete` (string, integer, number). */
const AUTOCOMPLETE_TYPES = new Set([3, 4, 10]);

/** What Discord returns for a registered guild command: no dm_permission, extra defaults, `shape` for the rest. */
function discordShape(json: Json, i: number, shape: Shape = {}): Json {
  const api: Json = JSON.parse(JSON.stringify(json));
  delete api.dm_permission;
  const reshape = (holder: Json) => {
    if (shape.dropEmptyOptions && Array.isArray(holder.options) && holder.options.length === 0) delete holder.options;
    for (const option of holder.options ?? []) {
      if (shape.explicitFalse) {
        if (AUTOCOMPLETE_TYPES.has(option.type)) option.autocomplete ??= false;
        if (option.type > 2) option.required ??= false;
      } else if (option.required === false) delete option.required;
      reshape(option);
    }
  };
  reshape(api);
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

function registered(guild: Guild, jsons: Json[], shape?: Shape): Map<string, ApplicationCommand> {
  const map = new Map<string, ApplicationCommand>();
  jsons.forEach((json, i) => {
    const command = new (ApplicationCommand as any)({}, discordShape(json, i, shape), guild) as ApplicationCommand;
    map.set(command.id, command);
  });
  return map;
}

/** A context whose guild returns `jsons` (or throws `error`) from `commands.fetch`. */
function ctxWith(jsons: Json[], error?: { code: number }, shape?: Shape) {
  const guild = makeFakeGuild();
  const withCommands = {
    ...guild,
    commands: {
      fetch: async () => {
        if (error) throw error;
        return registered(guild, jsons, shape);
      },
    },
  } as unknown as Guild;
  return makeCheckContext({ guild: withCommands });
}

const expected = commands.map(toJson);
const expectAll = async () => commands;
const check = createCommandSyncCheck(expectAll);

describe('core.commands', () => {
  test.each(
    SHAPES,
  )('in sync (%s): every real command, as Discord returns it, matches its builder', async (_, shape) => {
    expect(await check.run(ctxWith(expected, undefined, shape))).toEqual([]);
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

  /** The first command with a subcommand that takes no options, e.g. `/role list`. */
  const withEmptySub = () => {
    const command = JSON.parse(
      JSON.stringify(expected.find(c => c.options?.some((o: Json) => o.options?.length === 0))),
    );
    const sub = command.options.find((o: Json) => o.options?.length === 0);
    return { command, sub };
  };

  test.each(SHAPES)('outdated (%s): an option added to a subcommand that had none is caught', async (_, shape) => {
    const { command, sub } = withEmptySub();
    sub.options = [{ type: 3, name: 'extra', description: 'Added on Discord only' }];
    const stale = expected.map(c => (c.name === command.name ? command : c));
    const findings = await check.run(ctxWith(stale, undefined, shape));
    expect(findings.map(f => [f.code, f.params.names])).toEqual([['core.commands.outdated', `\`${command.name}\``]]);
  });

  test.each(SHAPES)('outdated (%s): autocomplete turned off on Discord is caught', async (_, shape) => {
    const command = JSON.parse(JSON.stringify(expected.find(c => JSON.stringify(c).includes('"autocomplete":true'))));
    /** Drops the first `autocomplete: true` found; false when there is none. */
    const clear = (options: Json[] = []): boolean =>
      options.some(o => {
        if (o.autocomplete !== true) return clear(o.options);
        delete o.autocomplete;
        return true;
      });
    expect(clear(command.options)).toBe(true);
    const stale = expected.map(c => (c.name === command.name ? command : c));
    const findings = await check.run(ctxWith(stale, undefined, shape));
    expect(findings.map(f => [f.code, f.params.names])).toEqual([['core.commands.outdated', `\`${command.name}\``]]);
  });

  test('alignUnsetOptions leaves the expected JSON untouched', () => {
    const { command } = withEmptySub();
    const before = JSON.stringify(command);
    const [registeredCommand] = registered(makeFakeGuild(), [command], { dropEmptyOptions: true }).values();
    expect(guildCommandMatches(registeredCommand, command)).toBe(true);
    expect(JSON.stringify(command)).toBe(before);
    expect(alignUnsetOptions(undefined, [])).toBeUndefined();
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
