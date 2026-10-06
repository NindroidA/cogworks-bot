/**
 * Health check registry and lang coverage: every finding code a registered
 * check can emit (plus its `<id>.error`) has an English string, and the
 * strings file has nothing a check can't emit.
 */
import { describe, expect, test } from 'bun:test';
import { HEALTH_SYSTEM_CHOICES } from '../../../../src/commands/builders/botHealth';
import { DEFAULT_LOCALE, getLangForLocale, lang, SUPPORTED_LOCALES } from '../../../../src/lang';
import { getChecks } from '../../../../src/utils/health/registry';

const strings = lang.health.findings as Record<string, string>;
const allCodes = getChecks().flatMap(check => [...check.codes, `${check.id}.error`]);

describe('health check registry', () => {
  test('has the core checks', () => {
    expect(getChecks('core').map(c => c.id)).toEqual([
      'core.global_staff_role',
      'core.locale',
      'core.staff_role',
      'core.guild_permission',
      'core.setup_state',
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

describe('lang.health.findings', () => {
  test.each(allCodes)('%s has an English string', code => {
    expect(typeof strings[code]).toBe('string');
    expect(strings[code].length).toBeGreaterThan(0);
  });

  test('has no strings for codes no check emits', () => {
    expect(Object.keys(strings).filter(code => !allCodes.includes(code))).toEqual([]);
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
