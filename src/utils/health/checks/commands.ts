/**
 * Slash-command sync check (design inventory §5.6): the commands registered in
 * the guild, fetched from Discord once per run, against the set the bot would
 * register there now. commandGating's last-registered signature is in-memory
 * only, so Discord is the source of truth.
 */
import type { ApplicationCommand } from 'discord.js';
import { filterCommandsByEnabled, getEnabledGatedModules } from '../../setup/commandGating';
import { defineCheck, type FindingTarget } from '../define';
import type { HealthCheck, HealthFinding } from '../types';

/** The commands the bot registers in a guild: `toJSON()` output or builders, as in `commandList`. */
export type ExpectedCommands = (guildId: string) => Promise<readonly unknown[]>;

const expectedGuildCommands: ExpectedCommands = async guildId =>
  filterCommandsByEnabled(await getEnabledGatedModules(guildId));

/** Command names listed in one finding; the rest are counted. */
const MAX_LISTED = 10;

type CommandJson = Record<string, unknown> & { name: string; type?: number };

function toJson(command: unknown): CommandJson {
  const maybe = command as { toJSON?: () => unknown };
  // The round trip drops undefined keys (builders emit `nsfw: undefined`), which `equals` reads as a difference.
  return JSON.parse(JSON.stringify(typeof maybe.toJSON === 'function' ? maybe.toJSON() : command));
}

/** Slash commands and context menus may share a name, so the type is part of the key. */
const keyOf = (name: string, type: number | undefined) => `${type ?? 1}:${name}`;

/**
 * Option fields where left out, null, false and [] all mean "none": the
 * builder JSON's key, then the key on an option discord.js received.
 */
const UNSET_ALIKE = [
  ['options', 'options'],
  ['choices', 'choices'],
  ['channel_types', 'channelTypes'],
  ['autocomplete', 'autocomplete'],
  ['required', 'required'],
] as const;

const isUnset = (value: unknown) =>
  value === undefined || value === null || value === false || (Array.isArray(value) && value.length === 0);

type OptionLike = Record<string, unknown>;

/**
 * A copy of the expected options with every field that is unset on both sides
 * written the way Discord returned it, matched by name at every level. The
 * builders send `options: []` on subcommands without options, and discord.js
 * (14.26) compares nested option counts without the `?? 0` it uses at the top
 * level, so a subcommand Discord returns without the key would read as
 * changed. A field set on only one side is left alone, so real changes still show.
 */
export function alignUnsetOptions(expected: unknown, registered: readonly unknown[] | undefined): unknown {
  if (!Array.isArray(expected)) return expected;
  const byName = new Map((registered ?? []).map(option => [(option as OptionLike).name, option as OptionLike]));
  return expected.map((raw: OptionLike) => {
    const theirs = byName.get(raw.name);
    if (!theirs) return raw;
    const option = { ...raw };
    for (const [ours, received] of UNSET_ALIKE) {
      if (!isUnset(option[ours]) || !isUnset(theirs[received])) continue;
      if (theirs[received] === undefined) delete option[ours];
      else option[ours] = theirs[received];
    }
    if (Array.isArray(option.options)) option.options = alignUnsetOptions(option.options, theirs.options as unknown[]);
    return option;
  });
}

/**
 * `ApplicationCommand#equals` for a guild command, whichever way Discord
 * writes fields that are empty (see `alignUnsetOptions`). Discord ignores
 * `dm_permission`, `integration_types` and `contexts` on guild commands
 * (discord.js reads `dmPermission` as null there), so Discord's own values are
 * used for those; otherwise every command would read as changed.
 */
export function guildCommandMatches(registered: ApplicationCommand, expected: Record<string, unknown>): boolean {
  const { dm_permission: _ignored, ...rest } = expected;
  const comparable = {
    ...rest,
    options: alignUnsetOptions(rest.options, registered.options),
    integration_types: registered.integrationTypes ?? [],
    contexts: registered.contexts ?? [],
  };
  return registered.equals(comparable as unknown as Parameters<ApplicationCommand['equals']>[0]);
}

function listNames(names: readonly string[]): string {
  const shown = names
    .slice(0, MAX_LISTED)
    .map(name => `\`${name}\``)
    .join(', ');
  return names.length > MAX_LISTED ? `${shown} +${names.length - MAX_LISTED}` : shown;
}

export function createCommandSyncCheck(expectedCommands: ExpectedCommands = expectedGuildCommands): HealthCheck {
  return defineCheck(
    {
      id: 'core.commands',
      system: 'core',
      entities: [],
      names: ['no_scope', 'missing', 'outdated', 'unexpected'],
    },
    async (ctx, emit) => {
      const fetched = await ctx.rest.fetch('commands', () => ctx.guild.commands.fetch({ withLocalizations: true }));
      // Over budget: the runner lists it under notChecked.
      if (fetched.status === 'skipped') return [];
      const at: FindingTarget = { entity: 'ApplicationCommand' };
      // 50001 on this route means the bot was added without the applications.commands scope.
      if (fetched.status === 'inaccessible') {
        const botId = ctx.me?.id ?? ctx.guild.client?.user?.id ?? '';
        return [emit('no_scope', 'block', 'manual', { ...at, params: { botId } })];
      }
      // 5xx, 429 or a timeout proves nothing; the runner reports it as core.commands.error.
      if (fetched.status !== 'ok') throw new Error(`Could not list the guild's commands (${fetched.status})`);

      const expected = new Map<string, CommandJson>();
      for (const json of (await expectedCommands(ctx.guildId)).map(toJson))
        expected.set(keyOf(json.name, json.type), json);

      const missing: string[] = [];
      const outdated: string[] = [];
      const unexpected: string[] = [];
      const registered = new Set<string>();
      for (const command of fetched.value.values()) {
        const key = keyOf(command.name, command.type);
        registered.add(key);
        const json = expected.get(key);
        if (!json) unexpected.push(command.name);
        else if (!guildCommandMatches(command, json)) outdated.push(command.name);
      }
      for (const [key, json] of expected) if (!registered.has(key)) missing.push(json.name);

      // Every case is repaired the same way: re-register the guild's command set.
      const out: HealthFinding[] = [];
      const params = (names: string[]) => ({ ...at, params: { count: names.length, names: listNames(names) } });
      if (missing.length > 0) out.push(emit('missing', 'degraded', 'auto', params(missing)));
      if (outdated.length > 0) out.push(emit('outdated', 'degraded', 'auto', params(outdated)));
      if (unexpected.length > 0) out.push(emit('unexpected', 'cosmetic', 'auto', params(unexpected)));
      return out;
    },
  );
}

export const COMMAND_CHECKS: readonly HealthCheck[] = [createCommandSyncCheck()];
