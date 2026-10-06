/**
 * Community feature checks end to end: registry wiring, and a messy legacy
 * guild run through the real registry and repo loader, which must find every
 * problem, stay guild-scoped, and never write.
 */
import { describe, expect, test } from 'bun:test';
import { HEALTH_ENTITIES, repoRowLoader } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runHealthCheck } from '../../../../src/utils/health/runner';
import { makeFakeGuild } from '../../../helpers/fakeGuild';
import { type FakeRepo, makeFakeRepo, writeCallCount } from '../../../helpers/fakeRepo';
import { G, GONE_CHANNEL, GONE_ROLE, guildInit, HIGH_ROLE, ROLE } from './communityFixtures';

describe('community check registry', () => {
  test.each([
    ['announcement', ['announcement.config', 'announcement.template']],
    ['xp', ['xp.config', 'xp.role_reward']],
    ['starboard', ['starboard.config']],
    ['onboarding', ['onboarding.config']],
  ] as const)('%s checks are registered', (system, ids) => {
    expect(getChecks(system).map(c => c.id)).toEqual([...ids]);
  });

  test('every declared entity is guild-scoped and registered', () => {
    for (const check of getChecks()) {
      for (const entity of check.entities) expect(HEALTH_ENTITIES[entity]).toBeDefined();
    }
  });
});

describe('messy legacy guild (real registry and repo loader)', () => {
  const OTHER = '100000000000000777';

  function repos(): Record<string, FakeRepo> {
    const fakes: Record<string, FakeRepo> = Object.fromEntries(
      Object.keys(HEALTH_ENTITIES).map(name => [name, makeFakeRepo([])]),
    );
    const add = (name: string, rows: Record<string, unknown>[]) => {
      fakes[name] = makeFakeRepo(rows);
    };
    add('AnnouncementConfig', [{ id: 1, guildId: G, defaultChannelId: GONE_CHANNEL, defaultRoleId: ROLE }]);
    add('AnnouncementTemplate', [{ id: 1, guildId: G, name: 'maintenance', color: 'nope', title: 't', body: 'b' }]);
    add('XPConfig', [
      { id: 1, guildId: G, enabled: true, xpPerMessageMin: 15, xpPerMessageMax: 25, ignoredRoles: [GONE_ROLE] },
    ]);
    add('XPRoleReward', [
      { id: 1, guildId: G, level: 5, roleId: HIGH_ROLE },
      { id: 2, guildId: OTHER, level: 5, roleId: GONE_ROLE },
    ]);
    add('StarboardConfig', [
      { id: 1, guildId: G, enabled: true, channelId: GONE_CHANNEL, emoji: '⭐', threshold: 3 },
    ]);
    add('OnboardingConfig', [{ id: 1, guildId: G, enabled: true, welcomeMessage: 'Hi', steps: [], completionRoleId: null }]);
    return fakes;
  }

  test('finds every problem, stays guild-scoped, and never writes', async () => {
    const fakes = repos();
    const loader = repoRowLoader(target => fakes[(target as { name: string }).name]);
    const report = await runHealthCheck(makeFakeGuild(guildInit()), {}, { loadRows: loader });
    const found = (system: keyof typeof report.systems) => report.systems[system]?.findings.map(f => f.code);

    expect(found('announcement')).toEqual([
      'announcement.config.channel_missing',
      'announcement.template.default_missing',
      'announcement.template.default_missing',
      'announcement.template.default_missing',
      'announcement.template.default_missing',
      'announcement.template.color_invalid',
    ]);
    expect(found('xp')).toEqual(['xp.config.ignored_role_missing', 'xp.role_reward.role_above_bot']);
    expect(found('starboard')).toEqual(['starboard.config.channel_missing']);
    expect(found('onboarding')).toEqual(['onboarding.config.no_steps']);
    expect(report.systems.starboard?.status).toBe('fail');
    expect(report.systems.xp?.status).toBe('warn');
    // Another guild's deleted reward role never shows up.
    expect(report.systems.xp?.findings.some(f => f.refId === GONE_ROLE && f.entity === 'XPRoleReward')).toBe(false);

    for (const [name, repo] of Object.entries(fakes)) {
      expect({ name, writes: writeCallCount(repo) }).toEqual({ name, writes: 0 });
      expect({ name, finds: repo.findCalls }).toEqual({ name, finds: [{ where: { guildId: G } }] });
    }
  });

  test('systems a guild never set up read as not configured', async () => {
    const empty = Object.fromEntries(Object.keys(HEALTH_ENTITIES).map(name => [name, makeFakeRepo([])]));
    const loader = repoRowLoader(target => empty[(target as { name: string }).name]);
    const report = await runHealthCheck(makeFakeGuild(guildInit()), {}, { loadRows: loader });
    for (const system of ['announcement', 'xp', 'starboard', 'onboarding'] as const) {
      expect({ system, status: report.systems[system]?.status }).toEqual({ system, status: 'not_configured' });
    }
  });
});
