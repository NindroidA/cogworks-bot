/**
 * findingKey: short, stable across re-checks, blind to param order, and
 * different whenever the finding points somewhere else.
 */
import { describe, expect, test } from 'bun:test';
import { getChecks } from '../../../../../src/utils/health/registry';
import { findingKey } from '../../../../../src/utils/health/repair/keys';
import { runHealthCheckWithContext } from '../../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../../src/utils/health/types';
import { makeFakeGuild } from '../../../../helpers/fakeGuild';
import { GONE_CHANNEL, GONE_ROLE, guildInit, TEXT } from '../communityFixtures';

const base: HealthFinding = {
  code: 'xp.config.ignored_channel_missing',
  system: 'xp',
  severity: 'cosmetic',
  repair: 'auto',
  entity: 'XPConfig',
  rowId: 5,
  field: 'ignoredChannels',
  refId: GONE_CHANNEL,
  params: { channelId: GONE_CHANNEL, extra: 1 },
};

describe('findingKey', () => {
  test('is 16 hex characters', () => {
    expect(findingKey(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('ignores param order, severity and the repair class', () => {
    const reordered: HealthFinding = {
      ...base,
      severity: 'block',
      repair: 'confirm',
      params: { extra: 1, channelId: GONE_CHANNEL },
    };
    expect(findingKey(reordered)).toBe(findingKey(base));
  });

  test.each([
    ['code', { code: 'xp.config.level_up_channel_missing' }],
    ['entity', { entity: 'StarboardConfig' }],
    ['row', { rowId: 6 }],
    ['field', { field: 'multiplierChannels' }],
    ['ref', { refId: TEXT }],
    ['params', { params: { channelId: TEXT } }],
  ])('changes with the %s', (_name, change) => {
    expect(findingKey({ ...base, ...change } as HealthFinding)).not.toBe(findingKey(base));
  });

  test('is the same for the same problem on two separate check runs', async () => {
    const run = async () => {
      const rows = {
        XPConfig: [
          {
            id: 5,
            enabled: true,
            levelUpChannelId: null,
            ignoredChannels: [GONE_CHANNEL],
            ignoredRoles: [GONE_ROLE],
            multiplierChannels: null,
            xpPerMessageMin: 15,
            xpPerMessageMax: 25,
          },
        ],
      };
      const checks = getChecks('xp');
      const loadRows = async (entity: string) => (rows as Record<string, unknown[]>)[entity] ?? [];
      const { report } = await runHealthCheckWithContext(makeFakeGuild(guildInit()), {}, { checks, loadRows });
      return report.systems.xp?.findings.map(findingKey);
    };
    const first = await run();
    expect(first).toHaveLength(2);
    expect(await run()).toEqual(first);
  });
});
