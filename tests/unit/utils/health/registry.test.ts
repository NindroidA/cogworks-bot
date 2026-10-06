/**
 * Health check registry and lang coverage: every finding code a registered
 * check can emit (plus its `<id>.error`) has an English string, the strings
 * file has nothing a check can't emit, and `/bot-health` shows only steps an
 * admin can take: a slash command a string names exists as written, and no
 * string promises a repair command that doesn't exist yet.
 */
import { describe, expect, test } from 'bun:test';
import { ApplicationCommandOptionType } from 'discord.js';
import { HEALTH_SYSTEM_CHOICES } from '../../../../src/commands/builders/botHealth';
import { commands } from '../../../../src/commands/commandList';
import { DEFAULT_LOCALE, getLangForLocale, lang, SUPPORTED_LOCALES } from '../../../../src/lang';
import { getChecks } from '../../../../src/utils/health/registry';
import { HEALTH_SYSTEMS, HEALTH_SYSTEMS_NOT_CHECKED } from '../../../../src/utils/health/systems';

const strings = lang.health.findings as Record<string, string>;
const allCodes = getChecks().flatMap(check => [...check.codes, `${check.id}.error`]);

interface CommandOption {
  type: number;
  name: string;
  options?: CommandOption[];
}
const NESTED = new Set<number>([ApplicationCommandOptionType.Subcommand, ApplicationCommandOptionType.SubcommandGroup]);

/** Every slash-command path a member can run ('ticket manage user-restrict'), with its option names. */
function commandPaths(): Map<string, Set<string>> {
  const paths = new Map<string, Set<string>>();
  const walk = (path: string, options: CommandOption[] = []) => {
    const nested = options.filter(option => NESTED.has(option.type));
    if (nested.length === 0) paths.set(path, new Set(options.map(option => option.name)));
    for (const option of nested) walk(`${path} ${option.name}`, option.options);
  };
  for (const command of commands) {
    const json = ('toJSON' in command ? command.toJSON() : command) as { name: string; type?: number };
    // Context-menu commands have no slash path.
    if (json.type === undefined || json.type === 1) walk(json.name, (json as { options?: CommandOption[] }).options);
  }
  return paths;
}

describe('health check registry', () => {
  test('has the core checks and the command sync check', () => {
    expect(getChecks('core').map(c => c.id)).toEqual([
      'core.global_staff_role',
      'core.locale',
      'core.staff_role',
      'core.guild_permission',
      'core.setup_state',
      'core.commands',
    ]);
  });

  test('check ids are unique', () => {
    const ids = getChecks().map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every code is namespaced by its check id', () => {
    for (const check of getChecks()) {
      for (const code of check.codes) expect(code.startsWith(`${check.id}.`)).toBe(true);
    }
  });

  test('getChecks(system) filters', () => {
    expect(getChecks('ticket').every(c => c.system === 'ticket')).toBe(true);
    expect(getChecks().length).toBeGreaterThanOrEqual(getChecks('core').length);
  });
});

describe('/bot-health system choices', () => {
  const labels = lang.health.command.systems as Record<string, string>;

  // A new system's first checks must also add it to the choices and to command.systems.
  test.each([...new Set(getChecks().map(check => check.system))])('%s is a choice with a label', system => {
    expect(HEALTH_SYSTEM_CHOICES).toContain(system);
    expect(labels[system]).toBeString();
  });

  // And the other way: a choice without checks would only ever say "no checks for this system yet".
  test.each([...HEALTH_SYSTEM_CHOICES])('the %s choice has at least one check', system => {
    expect(getChecks(system).length).toBeGreaterThan(0);
  });

  // When one gets checks, it moves to the choices (and off the "not checked yet" list) with them.
  test.each([...HEALTH_SYSTEMS_NOT_CHECKED])('%s has no checks yet, a label, and is not a choice', system => {
    expect(getChecks(system)).toEqual([]);
    expect(HEALTH_SYSTEMS).toContain(system);
    expect(HEALTH_SYSTEM_CHOICES).not.toContain(system);
    expect(labels[system]).toBeString();
  });

  test('every choice has a label', () => {
    for (const system of ['all', ...HEALTH_SYSTEM_CHOICES])
      expect({ system, label: labels[system] }).toEqual({
        system,
        label: expect.any(String),
      });
  });

  test('staff roles are checked under Core, so they are not a choice of their own', () => {
    expect(
      getChecks()
        .filter(check => check.id.includes('staff_role'))
        .map(check => check.system),
    ).toEqual(['core', 'core']);
    expect(HEALTH_SYSTEM_CHOICES).not.toContain('staffRole');
    expect(labels.staffRole).toBeUndefined();
  });
});

/** The leaf strings of a nested lang object, keyed by dotted path. */
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      Object.entries(flatten(child, prefix ? `${prefix}.${key}` : key)),
    ),
  );
}

describe('lang.health.findings', () => {
  test.each(allCodes)('%s has an English string', code => {
    expect(typeof strings[code]).toBe('string');
    expect(strings[code].length).toBeGreaterThan(0);
  });

  test('has no strings for codes no check emits', () => {
    expect(Object.keys(strings).filter(code => !allCodes.includes(code))).toEqual([]);
  });

  test('every `/command` a string names is a real command path, with real option names', () => {
    const paths = commandPaths();
    const wrong: string[] = [];
    for (const [code, text] of Object.entries(strings)) {
      for (const [, mention] of text.matchAll(/`\/([^`]+)`/g)) {
        // `/xp-setup config setting:Level-Up Channel value:none`: the path, then `name:value` options.
        const words = mention.split(' ');
        const firstOption = words.findIndex(word => word.includes(':'));
        const path = (firstOption === -1 ? words : words.slice(0, firstOption)).join(' ');
        const options = words.filter(word => word.includes(':')).map(word => word.split(':')[0]);
        const known = paths.get(path);
        if (!known || options.some(option => !known.has(option))) wrong.push(`${code}: /${mention}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('no string promises a repair command or a fix that nothing performs yet', () => {
    const promise =
      /bot-health repair|automatic|coming soon|\bcan be (?:removed|marked|posted|added|converted|cleared)\b/i;
    const all = { ...strings, ...flatten(lang.health.command) };
    expect(Object.entries(all).filter(([, text]) => promise.test(text))).toEqual([]);
  });

  test('every finding ends with a full sentence, and every <check>.error says to try again', () => {
    const entries = Object.entries(strings);
    expect(entries.filter(([, text]) => !/[.)]$/.test(text))).toEqual([]);
    expect(entries.filter(([code, text]) => code.endsWith('.error') && !text.endsWith('Try again later.'))).toEqual([]);
  });

  // A no-op once English is the only shipped locale.
  test('other locales fall back to English', () => {
    for (const locale of SUPPORTED_LOCALES.filter(l => l !== DEFAULT_LOCALE)) {
      const findings = getLangForLocale(locale).health.findings as Record<string, string>;
      expect({ locale, text: findings['core.locale.unsupported'] }).toEqual({
        locale,
        text: strings['core.locale.unsupported'],
      });
    }
  });
});
