/**
 * Repair coverage: every action belongs to a real check code and has a label,
 * and every code a check emits as auto or confirm today either has an action
 * or is deferred to a named later PR.
 */
import { describe, expect, test } from 'bun:test';
import { lang } from '../../../../../src/lang';
import { getChecks } from '../../../../../src/utils/health/registry';
import { REF_REPAIRS } from '../../../../../src/utils/health/repair/refRepairs';

const checkCodes = new Set(getChecks().flatMap(check => check.codes));
const actions = Object.keys(REF_REPAIRS);
const labels = lang.health.repair.actions as Record<string, string>;

const FIELD_INPUTS = ['too_many_fields', 'field_id', 'field_label', 'field_placeholder', 'field_length'];

/** Field-level repairs and the default-template top-up (#41 repair plan, PR-5). */
const PR5 = [
  'core.global_staff_role.enabled_without_role',
  'core.global_staff_role.format_legacy',
  'core.locale.unsupported',
  'core.staff_role.invalid',
  'core.staff_role.duplicate',
  'core.staff_role.format_legacy',
  'core.guild_permission.unknown_feature',
  'core.guild_permission.unknown_level',
  'core.guild_permission.missing_role',
  'core.setup_state.unknown_system',
  'core.commands.missing',
  'core.commands.outdated',
  'core.commands.unexpected',
  'ticket.type.multiple_defaults',
  'ticket.type.color_invalid',
  'ticket.type.emoji_invalid',
  'ticket.restriction.unknown_type',
  'ticket.open.creation_failed',
  'application.position.emoji_invalid',
  'memory.tag.orphan',
  'memory.item.orphan',
  'reactionRole.menu.mode',
  'announcement.template.default_missing',
  'xp.config.multiplier_invalid',
  'xp.config.rate_inverted',
  'xp.role_reward.duplicate_level',
  'starboard.config.threshold_invalid',
];

/** Deferred past this series: a re-post is a Discord action, and the rest need the admin's input. */
const LATER = [
  'ticket.panel.message_missing',
  'application.panel.message_missing',
  ...FIELD_INPUTS.map(name => `ticket.type.${name}`),
  ...FIELD_INPUTS.map(name => `application.position.${name}`),
  'memory.tag.duplicate',
  'memory.tag.not_in_forum',
];

const DEFERRED = [...PR5, ...LATER];

/**
 * The codes checks emit as auto or confirm today, read from the checks (the
 * repair class is chosen per finding, so it can't be listed from the registry).
 * A check that starts emitting another code as auto or confirm adds it here,
 * and to an action or DEFERRED.
 */
const REPAIRABLE_TODAY = [
  ...DEFERRED,
  'core.global_staff_role.missing',
  'core.staff_role.missing',
  ...['ticket', 'application'].flatMap(system => [
    `${system}.panel.channel_missing`,
    `${system}.panel.category_missing`,
    `${system}.archive.channel_missing`,
    `${system}.open.channel_missing`,
  ]),
  'announcement.config.channel_missing',
  'announcement.config.role_missing',
  'memory.forum.missing',
  'memory.forum.welcome_missing',
  'memory.item.thread_missing',
  'reactionRole.option.role_missing',
  'reactionRole.menu.channel_missing',
  'reactionRole.menu.message_missing',
  'xp.config.level_up_channel_missing',
  'xp.config.ignored_channel_missing',
  'xp.config.ignored_role_missing',
  'xp.config.multiplier_channel_missing',
  'xp.role_reward.role_missing',
  'starboard.config.channel_missing',
  'starboard.config.ignored_channel_missing',
  'onboarding.config.completion_role_missing',
  'onboarding.config.step_role_missing',
  'rules.config.channel_missing',
  'rules.config.message_missing',
];

describe('repair coverage', () => {
  test('every action is a code some check emits', () => {
    expect(actions.filter(code => !checkCodes.has(code))).toEqual([]);
  });

  test('every action has a label, and every label an action', () => {
    expect(actions.filter(code => typeof labels[code] !== 'string' || labels[code].length === 0)).toEqual([]);
    expect(Object.keys(labels).filter(code => !actions.includes(code))).toEqual([]);
  });

  test('every action runs a delete-event patch on the columns of its finding', () => {
    for (const [code, repair] of Object.entries(REF_REPAIRS)) {
      expect({ code, patch: typeof repair.patch, fields: repair.fields.length > 0 }).toEqual({
        code,
        patch: 'function',
        fields: true,
      });
    }
  });

  test("today's auto and confirm codes all have an action or are deferred", () => {
    const covered = new Set([...actions, ...DEFERRED]);
    expect(REPAIRABLE_TODAY.filter(code => !covered.has(code))).toEqual([]);
    // And no action for a code that is only ever manual.
    expect(actions.filter(code => !REPAIRABLE_TODAY.includes(code))).toEqual([]);
  });

  test('deferred codes are real, listed once, and not also actions', () => {
    expect(DEFERRED.filter(code => !checkCodes.has(code))).toEqual([]);
    expect(new Set(DEFERRED).size).toBe(DEFERRED.length);
    expect(DEFERRED.filter(code => actions.includes(code))).toEqual([]);
  });

  test('saved-memory deletes ask first even though the checks rate them auto', () => {
    const confirmed = Object.entries(REF_REPAIRS)
      .filter(([, repair]) => repair.confirm)
      .map(([code]) => code);
    expect(confirmed).toEqual(['memory.forum.missing', 'memory.item.thread_missing']);
  });
});
