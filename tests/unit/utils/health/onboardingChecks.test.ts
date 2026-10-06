/**
 * Onboarding health check: steps, the welcome message, the completion role and
 * role-select options, rated by what the DM flow does with each.
 */
import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import { codes, G, GONE_ROLE, HIGH_ROLE, MANAGED_ROLE, ROLE, ROLE_2, runOne } from './communityFixtures';

const id = 'onboarding.config';
const step = (overrides: Record<string, unknown> = {}) => ({
  id: 'welcome',
  type: 'message',
  title: 'Welcome',
  description: 'Hi',
  required: true,
  ...overrides,
});
const roleStep = (roleIds: string[], overrides: Record<string, unknown> = {}) =>
  step({ id: 'roles', type: 'role-select', options: roleIds.map(roleId => ({ label: roleId, roleId })), ...overrides });
const onboarding = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  guildId: G,
  enabled: true,
  welcomeMessage: 'Welcome to {server}!',
  steps: [step(), roleStep([ROLE, ROLE_2])],
  completionRoleId: ROLE,
  ...overrides,
});
const run = (overrides: Record<string, unknown> = {}, guild = {}) =>
  runOne(id, { OnboardingConfig: [onboarding(overrides)] }, guild);

describe('onboarding.config', () => {
  test('pass: valid steps and assignable roles', async () => {
    expect(await run()).toEqual([]);
    expect(await run({ completionRoleId: null, steps: [step()] })).toEqual([]);
  });

  test('pass: disabled onboarding is not checked', async () => {
    expect(await run({ enabled: false, steps: [] })).toEqual([]);
  });

  test('fail: enabled with no steps (or a non-array steps column) blocks', async () => {
    for (const steps of [[], null, 'oops']) {
      const [f] = await run({ steps });
      expect(f).toMatchObject({ code: 'onboarding.config.no_steps', system: 'onboarding', severity: 'block' });
    }
  });

  test('welcome message: judged as rendered (server and member names filled in), not by stored length', async () => {
    // The stored text is capped at 2000 characters; only the rendered embed can pass Discord's 4096.
    expect(await run({ welcomeMessage: 'x'.repeat(2000) })).toEqual([]);
    // {user} becomes a display name of 1 to 32 characters: too long only for members with long names.
    const [some] = await run({ welcomeMessage: '{user}'.repeat(200) });
    expect(some).toMatchObject({
      code: 'onboarding.config.welcome_too_long',
      severity: 'degraded',
      repair: 'manual',
      field: 'welcomeMessage',
      params: { length: 6400 },
    });
    // {server} with a 100-character server name: too long for every member, so onboarding never starts.
    const rows = { OnboardingConfig: [onboarding({ welcomeMessage: '{server}'.repeat(250) })] };
    const longName = (guild: { name: string }) => {
      guild.name = 'n'.repeat(100);
    };
    const [all] = await runOne(id, rows, {}, { patch: longName });
    expect(all).toMatchObject({
      code: 'onboarding.config.welcome_too_long',
      severity: 'block',
      params: { length: 25000 },
    });
  });

  test('fail: completion role deleted (auto), above the bot, or managed', async () => {
    const [missing] = await run({ completionRoleId: GONE_ROLE });
    expect(missing).toMatchObject({
      code: 'onboarding.config.completion_role_missing',
      severity: 'degraded',
      repair: 'auto',
      field: 'completionRoleId',
      refId: GONE_ROLE,
    });
    expect(codes(await run({ completionRoleId: HIGH_ROLE }))).toEqual(['onboarding.config.completion_role_above_bot']);
    expect(codes(await run({ completionRoleId: MANAGED_ROLE }))).toEqual([
      'onboarding.config.completion_role_unassignable',
    ]);
  });

  test('fail: the bot lacks Manage Roles only matters when roles are granted', async () => {
    const guild = { botPermissions: [PermissionFlagsBits.ViewChannel] };
    expect(codes(await run({}, guild))).toEqual(['onboarding.config.no_manage_roles']);
    expect(await run({ completionRoleId: null, steps: [step()] }, guild)).toEqual([]);
  });

  test('fail: duplicate step id', async () => {
    const findings = await run({ steps: [step(), step({ title: 'Again' })] });
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'onboarding.config.step_duplicate_id',
        severity: 'degraded',
        field: 'steps',
        params: { stepId: 'welcome', step: 2 },
      }),
    ]);
  });

  test('fail: unknown step type blocks when required, is degraded when optional', async () => {
    const [required] = await run({ steps: [step({ type: 'quiz' })] });
    expect(required).toMatchObject({
      code: 'onboarding.config.step_unknown_type',
      severity: 'block',
      params: { stepId: 'welcome', step: 1, type: 'quiz' },
    });
    const [optional] = await run({ steps: [step({ type: 'quiz', required: false })] });
    expect(optional).toMatchObject({ severity: 'degraded' });
  });

  test('fail: step id too long for the longest custom id its type builds; pass at the limit', async () => {
    const tooLong = ['onboarding.config.step_id_too_long'];
    // message, channel-suggest, custom-question: 'onboarding_continue_' (20 characters).
    for (const type of ['message', 'channel-suggest', 'custom-question']) {
      expect(await run({ steps: [step({ type, id: 'a'.repeat(80) })] })).toEqual([]);
      expect(codes(await run({ steps: [step({ type, id: 'a'.repeat(81) })] }))).toEqual(tooLong);
    }
    // rules-accept: only 'onboarding_accept_' (18).
    expect(await run({ steps: [step({ type: 'rules-accept', id: 'a'.repeat(82) })] })).toEqual([]);
    expect(codes(await run({ steps: [step({ type: 'rules-accept', id: 'a'.repeat(83) })] }))).toEqual(tooLong);
    // role-select with options: 'onboarding_confirmrole_' (23).
    expect(await run({ steps: [roleStep([ROLE], { id: 'a'.repeat(77) })] })).toEqual([]);
    expect(codes(await run({ steps: [roleStep([ROLE], { id: 'a'.repeat(78) })] }))).toEqual(tooLong);
  });

  test('pass: steps that send no components have no custom id to overflow', async () => {
    // A role-select step without options sends only its embed.
    expect(await run({ completionRoleId: null, steps: [roleStep([], { id: 'a'.repeat(150) })] })).toEqual([]);
    // An unknown type sends nothing: only the type is reported.
    expect(codes(await run({ steps: [step({ type: 'quiz', id: 'a'.repeat(150) })] }))).toEqual([
      'onboarding.config.step_unknown_type',
    ]);
  });

  test('fail: role-select with more than 25 options or a repeated role', async () => {
    const many = Array.from({ length: 26 }, () => ROLE);
    expect(codes(await run({ steps: [roleStep(many)] }))).toEqual([
      'onboarding.config.step_too_many_options',
      'onboarding.config.step_duplicate_role',
    ]);
  });

  test('fail: step roles deleted (auto), above the bot, or @everyone', async () => {
    const findings = await run({ steps: [roleStep([ROLE, GONE_ROLE, HIGH_ROLE, G])] });
    expect(findings.map(f => [f.code, f.refId])).toEqual([
      ['onboarding.config.step_role_missing', GONE_ROLE],
      ['onboarding.config.step_role_above_bot', HIGH_ROLE],
      ['onboarding.config.step_role_unassignable', G],
    ]);
    expect(findings[0]).toMatchObject({ repair: 'auto', params: { stepId: 'roles', step: 1, roleId: GONE_ROLE } });
  });
});
