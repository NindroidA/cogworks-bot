/**
 * XP health checks: XPConfig references and rates, and role rewards
 * (assignable, one per level, at most 25). A disabled XP system isn't checked.
 */
import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import {
  CATEGORY,
  codes,
  G,
  GONE_CHANNEL,
  GONE_ROLE,
  HIGH_ROLE,
  LOCKED,
  MANAGED_ROLE,
  ROLE,
  ROLE_2,
  runOne,
  TEXT,
  VOICE,
} from './communityFixtures';

const xpConfig = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  guildId: G,
  enabled: true,
  xpPerMessageMin: 15,
  xpPerMessageMax: 25,
  levelUpChannelId: TEXT,
  ignoredChannels: [VOICE],
  ignoredRoles: [ROLE],
  multiplierChannels: { [TEXT]: 2 },
  ...overrides,
});

describe('xp.config', () => {
  const id = 'xp.config';
  const run = (overrides: Record<string, unknown> = {}) => runOne(id, { XPConfig: [xpConfig(overrides)] });

  test('pass: healthy config; null level-up channel means "same channel"', async () => {
    expect(await run()).toEqual([]);
    expect(await run({ levelUpChannelId: null, ignoredChannels: null, multiplierChannels: null })).toEqual([]);
  });

  test('pass: a disabled XP system is not checked', async () => {
    expect(await run({ enabled: false, levelUpChannelId: GONE_CHANNEL, ignoredRoles: [GONE_ROLE] })).toEqual([]);
  });

  test('fail: deleted level-up channel (auto), wrong type, missing permissions', async () => {
    const [missing] = await run({ levelUpChannelId: GONE_CHANNEL });
    expect(missing).toMatchObject({
      code: 'xp.config.level_up_channel_missing',
      system: 'xp',
      severity: 'degraded',
      repair: 'auto',
      field: 'levelUpChannelId',
      refId: GONE_CHANNEL,
    });
    expect(codes(await run({ levelUpChannelId: CATEGORY }))).toEqual(['xp.config.level_up_channel_wrong_type']);
    const [perms] = await run({ levelUpChannelId: LOCKED });
    expect(perms).toMatchObject({
      code: 'xp.config.level_up_channel_permissions',
      params: { permissions: 'Send Messages' },
    });
  });

  test('fail: deleted ignored channels and roles are prunable', async () => {
    const findings = await run({ ignoredChannels: [VOICE, GONE_CHANNEL], ignoredRoles: [ROLE, GONE_ROLE] });
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'xp.config.ignored_channel_missing',
        severity: 'cosmetic',
        repair: 'auto',
        field: 'ignoredChannels',
        refId: GONE_CHANNEL,
        params: { channelId: GONE_CHANNEL },
      }),
      expect.objectContaining({
        code: 'xp.config.ignored_role_missing',
        refId: GONE_ROLE,
        params: { roleId: GONE_ROLE },
      }),
    ]);
  });

  test('fail: multiplier for a deleted channel (only that finding) and non-positive multipliers', async () => {
    const findings = await run({ multiplierChannels: { [TEXT]: 0, [VOICE]: -1, [GONE_CHANNEL]: -3 } });
    expect(findings.map(f => [f.code, f.refId])).toEqual([
      ['xp.config.multiplier_channel_missing', GONE_CHANNEL],
      ['xp.config.multiplier_invalid', TEXT],
      ['xp.config.multiplier_invalid', VOICE],
    ]);
    expect(findings[1]).toMatchObject({ severity: 'degraded', repair: 'confirm', params: { multiplier: '0' } });
  });

  test('fail: min above max; pass: min equal to max', async () => {
    const [f] = await run({ xpPerMessageMin: 30, xpPerMessageMax: 10 });
    expect(f).toMatchObject({ code: 'xp.config.rate_inverted', repair: 'confirm', params: { min: 30, max: 10 } });
    expect(await run({ xpPerMessageMin: 20, xpPerMessageMax: 20 })).toEqual([]);
  });
});

describe('xp.role_reward', () => {
  const id = 'xp.role_reward';
  const reward = (rowId: number, level: number, roleId: string) => ({ id: rowId, guildId: G, level, roleId });
  const run = (rewards: Record<string, unknown>[], guild = {}, enabled = true) =>
    runOne(id, { XPConfig: [xpConfig({ enabled })], XPRoleReward: rewards }, guild);

  test('pass: assignable roles, one per level', async () => {
    expect(await run([reward(1, 5, ROLE), reward(2, 10, ROLE_2)])).toEqual([]);
  });

  test('pass: rewards of a disabled XP system are not checked', async () => {
    expect(await run([reward(1, 5, GONE_ROLE)], {}, false)).toEqual([]);
  });

  test('fail: deleted role (cosmetic, auto: roleDelete removes the reward)', async () => {
    const [f] = await run([reward(1, 5, GONE_ROLE)]);
    expect(f).toMatchObject({
      code: 'xp.role_reward.role_missing',
      severity: 'cosmetic',
      repair: 'auto',
      entity: 'XPRoleReward',
      rowId: 1,
      refId: GONE_ROLE,
      params: { level: 5, roleId: GONE_ROLE },
    });
  });

  test('fail: role above the bot, and managed or @everyone roles', async () => {
    const findings = await run([reward(1, 5, HIGH_ROLE), reward(2, 6, MANAGED_ROLE), reward(3, 7, G)]);
    expect(codes(findings)).toEqual([
      'xp.role_reward.role_above_bot',
      'xp.role_reward.role_unassignable',
      'xp.role_reward.role_unassignable',
    ]);
    expect(findings.every(f => f.severity === 'degraded' && f.repair === 'manual')).toBe(true);
  });

  test('pass: hierarchy is not judged without the bot member', async () => {
    expect(await run([reward(1, 5, HIGH_ROLE)], { botPermissions: null })).toEqual([]);
  });

  test('fail: the bot lacks Manage Roles (one finding, not per reward)', async () => {
    const guild = { botPermissions: [PermissionFlagsBits.ViewChannel] };
    expect(codes(await run([reward(1, 5, ROLE), reward(2, 10, ROLE_2)], guild))).toEqual([
      'xp.role_reward.no_manage_roles',
    ]);
    expect(await run([], guild)).toEqual([]);
  });

  test('fail: two rewards at one level; the oldest row is kept', async () => {
    const findings = await run([reward(7, 5, ROLE_2), reward(3, 5, ROLE)]);
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'xp.role_reward.duplicate_level',
        repair: 'confirm',
        rowId: 7,
        field: 'level',
        params: { level: 5, roleId: ROLE_2, keptRowId: 3, keptRoleId: ROLE },
      }),
    ]);
  });

  test('fail: more than 25 rewards; pass: exactly 25', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => reward(i + 1, i + 1, ROLE));
    expect(codes(await run(many(26)))).toEqual(['xp.role_reward.too_many']);
    expect(await run(many(25))).toEqual([]);
  });
});
