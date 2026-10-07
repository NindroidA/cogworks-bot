/**
 * `fmt()`, the named-placeholder filler for lang strings (#41 step A6), and
 * proof that the strings moved from `{0}` to `{name}` read exactly as before:
 * each case fills the string as it was on main with the old call and the
 * renamed string with `fmt`, and the two must match.
 */
import { describe, expect, test } from 'bun:test';
import { fmt, lang } from '../../../src/lang';
import { formatLang } from '../../../src/utils';

describe('fmt', () => {
  test('fills named params and leaves unknown ones as written', () => {
    expect(fmt('{a} and {b} and {missing}', { a: 'x', b: 2 })).toBe('x and 2 and {missing}');
  });

  test('fills a placeholder everywhere it appears', () => {
    expect(fmt('{name}, meet {name}', { name: 'Ada' })).toBe('Ada, meet Ada');
  });

  test('inherited object keys never fill a placeholder', () => {
    expect(fmt('{constructor} {toString} {__proto__}', {})).toBe('{constructor} {toString} {__proto__}');
  });

  test('a value missing at runtime leaves its placeholder', () => {
    expect(fmt('Hi {user}', { user: undefined as unknown as string })).toBe('Hi {user}');
  });

  test('numbered placeholders are not filled', () => {
    expect(fmt('{0} and {name}', { 0: 'zero', name: 'n' })).toBe('{0} and n');
  });

  test('$ in a value goes in as written', () => {
    const value = "$& $1 $$ $` $'";
    expect(fmt('Role **{roleName}** ready', { roleName: value })).toBe(`Role **${value}** ready`);
    // The `.replace('{x}', value)` chains fmt replaces read these as patterns.
    expect('Role **{roleName}** ready'.replace('{roleName}', value)).not.toBe(`Role **${value}** ready`);
  });

  test('a value is never filled again', () => {
    expect(fmt('{name} in {channel}', { name: '{channel}', channel: '#general' })).toBe('{channel} in #general');
  });
});

describe('strings renamed from {0} to {name} read the same', () => {
  // [string as it was on main, the old call, the new call]
  const cases: [string, (old: string) => string, () => string][] = [
    [
      'Starboard has been configured! Messages with {0}+ {1} reactions will appear in {2}.',
      old => formatLang(old, (5).toString(), '⭐', '<#123>'),
      () => fmt(lang.starboard.setup.success, { threshold: 5, emoji: '⭐', channel: '<#123>' }),
    ],
    [
      'Import complete! Imported: {0}, Skipped: {1}, Failed: {2}',
      old => formatLang(old, 120, 3, 0),
      () => fmt(lang.import.commands.importComplete, { imported: 120, skipped: 3, failed: 0 }),
    ],
    [
      'Category: {0}/{1} | Status: {2}/{3}',
      old =>
        old.replace('{0}', String(4)).replace('{1}', String(15)).replace('{2}', String(2)).replace('{3}', String(5)),
      () =>
        fmt(lang.memory.manageTags.list.footer, { categoryCount: 4, categoryMax: 15, statusCount: 2, statusMax: 5 }),
    ],
    [
      "A {0} tag named '{1}' already exists.",
      old => old.replace('{0}', 'category').replace('{1}', 'Bug'),
      () => fmt(lang.memory.manageTags.add.duplicate, { type: 'category', name: 'Bug' }),
    ],
    [
      'Selected {0} role(s). Click **{1}** to continue.',
      old => formatLang(old, 2, 'Confirm'),
      () => fmt(lang.onboarding.engine.rolesSelectedHint, { count: 2, button: 'Confirm' }),
    ],
    [
      'Digest frequency set to **{0}** (day: {1}).',
      old => formatLang(old, 'weekly', 'Monday'),
      () => fmt(lang.analytics.setup.frequencySet, { frequency: 'weekly', day: 'Monday' }),
    ],
    [
      'Data export completed: {0} records from {1} tables',
      old => formatLang(old, (42).toString(), (7).toString()),
      () => fmt(lang.dataExport.completed, { records: 42, tables: 7 }),
    ],
    [
      "You're using this command too quickly. Please try again in {0} minutes.",
      old => formatLang(old, Math.ceil(90_000 / 60000).toString()),
      () => fmt(lang.errors.rateLimit, { minutes: Math.ceil(90_000 / 60000) }),
    ],
    [
      'Serving {0} servers',
      old => old.replace('{0}', (1234).toString()),
      () => fmt(lang.general.welcome.footer, { count: 1234 }),
    ],
    [
      '{0} issue(s) found across your reaction role menus.',
      old => formatLang(old, (3).toString()),
      () => fmt(lang.reactionRole.validate.issuesFound, { count: 3 }),
    ],
  ];

  test.each(cases)('%s', (old, oldCall, newCall) => {
    expect(newCall()).toBe(oldCall(old));
  });

  test('named strings that moved from .replace() chains read the same', () => {
    const rr = lang.reactionRole;
    expect(fmt(rr.add.success, { emoji: '🔴', role: '<@&9>', menu: 'Colors' })).toBe(
      rr.add.success.replace('{emoji}', '🔴').replace('{role}', '<@&9>').replace('{menu}', 'Colors'),
    );
    expect(fmt(lang.rules.setup.defaultMessage, { emoji: '✅', roleName: 'Member' })).toBe(
      lang.rules.setup.defaultMessage.replace('{emoji}', '✅').replace('{roleName}', 'Member'),
    );
    expect(fmt(lang.dev.bulkCloseTickets.totalTickets, { count: 8 })).toBe(
      lang.dev.bulkCloseTickets.totalTickets.replace('{count}', (8).toString()),
    );
    expect(fmt(lang.status.banner.warning, { level: 'Degraded' })).toBe(
      lang.status.banner.warning.replace('{level}', 'Degraded'),
    );
  });
});
