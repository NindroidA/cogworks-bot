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

  test('fail: welcome message over 2000 is cosmetic, over 4096 blocks', async () => {
    const [long] = await run({ welcomeMessage: 'x'.repeat(2001) });
    expect(long).toMatchObject({ code: 'onboarding.config.welcome_too_long', severity: 'cosmetic' });
    const [huge] = await run({ welcomeMessage: 'x'.repeat(4097) });
    expect(huge).toMatchObject({ code: 'onboarding.config.welcome_too_long', severity: 'block' });
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

  test('fail: step id too long for its longest custom id; pass at the limit', async () => {
    // 'onboarding_continue_' is 20 characters, 'onboarding_confirmrole_' 23.
    expect(await run({ steps: [step({ id: 'a'.repeat(80) })] })).toEqual([]);
    expect(codes(await run({ steps: [step({ id: 'a'.repeat(81) })] }))).toEqual(['onboarding.config.step_id_too_long']);
    expect(codes(await run({ steps: [roleStep([ROLE], { id: 'a'.repeat(78) })] }))).toEqual([
      'onboarding.config.step_id_too_long',
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
