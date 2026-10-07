/**
 * `fmt()`, the named-placeholder filler for lang strings (#41 step A6), and
 * proof that the strings moved from `{0}` to `{name}` read exactly as before:
 * each case fills the string as it was before the rename with the old call and
 * the renamed string with `fmt`, and the two must match.
 */
import { describe, expect, test } from 'bun:test';
import { fmt, lang } from '../../../src/lang';

/** `formatLang` as it was before #41 removed it, kept to fill the old `{0}` strings below. */
function formatLang(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const argIndex = parseInt(index, 10);
    return args[argIndex] !== undefined ? String(args[argIndex]) : match;
  });
}

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
  // [string as it was before the rename, the old call, the new call]
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
    [
      'SLA Breach: Ticket #{0} in <#{1}> has been waiting **{2}** minutes for a first response (target: {3} min).',
      old => formatLang(old, (17).toString(), '456', (95).toString(), (60).toString()),
      () => fmt(lang.ticket.sla.breachAlert, { ticketId: 17, channelId: '456', elapsed: 95, target: 60 }),
    ],
    [
      'Auto-close enabled: tickets in **{0}** status will close after **{1}** days of inactivity (warning {2}h before).',
      old => formatLang(old, 'pending', (7).toString(), (24).toString()),
      () => fmt(lang.ticket.workflow.autoCloseEnabled, { status: 'pending', days: 7, hours: 24 }),
    ],
    [
      'Status changed to **{0}** by {1}',
      old => formatLang(old, '🟡 Pending', '<@1>'),
      () => fmt(lang.ticket.workflow.statusChanged, { status: '🟡 Pending', user: '<@1>' }),
    ],
    [
      'Routing rule added: **{0}** tickets will be routed to **{1}**.',
      old => formatLang(old, 'billing', 'Support'),
      () => fmt(lang.ticket.routing.ruleAdded, { typeId: 'billing', role: 'Support' }),
    ],
    [
      'Custom ticket type **{0}** created successfully!',
      old => formatLang(old, 'Billing').replace('!', ''),
      () => fmt(lang.ticket.customTypes.typeAdd.success, { type: 'Billing' }).replace('!', ''),
    ],
    [
      '⚠️ Could not lift the softban ban on {0} in **{1}** after {2} attempts, so they are still banned. Unban them by hand (Server Settings → Bans).',
      old => old.replace('{0}', '<@1>').replace('{1}', 'Guild').replace('{2}', String(3)),
      () => fmt(lang.baitChannel.unbanGaveUp, { user: '<@1>', guildName: 'Guild', attempts: 3 }),
    ],
    [
      'Added {0} to whitelist',
      old => old.replace('{0}', 'User: {0}'.replace('{0}', 'ada')),
      () => fmt(lang.baitChannel.whitelist.added, { target: fmt(lang.baitChannel.whitelist.user, { user: 'ada' }) }),
    ],
    [
      '- Action Threshold: {0}/100',
      old => old.replace('{0}', (90).toString()),
      () => fmt(lang.baitChannel.status.actionThreshold, { threshold: 90 }),
    ],
    [
      "Couldn't delete the warning banner in <#{0}>. Delete it by hand: that channel is no longer monitored.",
      old => formatLang(old, '789'),
      () => fmt(lang.baitChannel.multiChannel.bannerDeleteFailed, { channelId: '789' }),
    ],
    [
      'Applied the **{0}** template partially. {1} of {2} rules created (hit 6-rule limit).',
      old => formatLang(old, 'Anti-spam', 2, 4),
      () => fmt(lang.automod.template.partialSuccess, { template: 'Anti-spam', created: 2, total: 4 }),
    ],
    [
      'Restoring would create {0} rule(s), but you only have {1} slot(s) available. Delete some rules first.',
      old => formatLang(old, 5, 1),
      () => fmt(lang.automod.restore.wouldExceedLimit, { count: 5, available: 1 }),
    ],
    [
      'automod-backup-{0}.json',
      old => old.replace('{0}', '123'),
      () => fmt(lang.automod.backup.fileName, { guildId: '123' }),
    ],
    [
      '**#{0}** <@{1}> — Level **{2}** | **{3}** XP',
      old =>
        old
          .replace('{0}', String(11))
          .replace('{1}', '42')
          .replace('{2}', String(7))
          .replace('{3}', (12345).toLocaleString()),
      () => fmt(lang.xp.leaderboard.entry, { rank: 11, userId: '42', level: 7, xp: (12345).toLocaleString() }),
    ],
    [
      "Set **{0}**'s XP to **{1}** (Level {2}).",
      old => old.replace('{0}', 'Ada').replace('{1}', (1500).toLocaleString()).replace('{2}', String(4)),
      () => fmt(lang.xp.admin.xpSet, { user: 'Ada', xp: (1500).toLocaleString(), level: 4 }),
    ],
    [
      'Current level-up message: {0}\nPlaceholders: `{user}`, `{level}`',
      // The admin's own message keeps its {user}/{level}, and so does the syntax hint.
      old => formatLang(old, 'GG {user}, you hit level {level}!'),
      () => fmt(lang.xp.config.currentLevelUpMessage, { message: 'GG {user}, you hit level {level}!' }),
    ],
    [
      '{0} by <@{1}> <t:{2}:R>',
      old => formatLang(old, 'Looks good', '99', (1700000000).toString()),
      () => fmt(lang.application.workflowInfo.noteEntry, { note: 'Looks good', userId: '99', time: 1700000000 }),
    ],
    [
      'Recurring event created from template **{0}** ({1}). Next occurrence: {2}.',
      old => formatLang(old, 'Game night', 'weekly', '<t:1700000000:F>'),
      () => fmt(lang.event.recurring.success, { template: 'Game night', pattern: 'weekly', next: '<t:1700000000:F>' }),
    ],
    [
      '{0}/25 templates',
      old => old.replace('{0}', (3).toString()),
      () => fmt(lang.event.template.list.footer, { count: 3 }),
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
    const ur = lang.ticket.customTypes.userRestrict;
    expect(fmt(ur.confirmRestrict, { user: '<@1>', type: 'Billing' })).toBe(
      ur.confirmRestrict.replace('{user}', '<@1>').replace('{type}', 'Billing'),
    );
    const kw = lang.baitChannel.keywords;
    expect(fmt(kw.add.success, { keyword: 'free nitro', weight: 40 })).toBe(
      kw.add.success.replace('{keyword}', 'free nitro').replace('{weight}', (40).toString()),
    );
  });
});
