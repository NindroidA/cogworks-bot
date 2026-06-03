import { describe, expect, test } from 'bun:test';
import { buildAuditReason, flagsTriggered } from '../../../../src/utils/baitChannel/auditReason';

describe('buildAuditReason', () => {
  test('builds the standard structure', () => {
    const reason = buildAuditReason({
      score: 87,
      channelName: 'trap-channel',
      flags: ['phishingUrl', 'newAccount'],
      messageId: '1234567890',
    });
    expect(reason).toBe('cogworks:bait score=87 ch=#trap-channel flags=[phishingUrl,newAccount] msgId=1234567890');
  });

  test('omits flags section when empty', () => {
    const reason = buildAuditReason({
      score: 42,
      channelName: 'general',
      messageId: '999',
    });
    expect(reason).toContain('score=42');
    expect(reason).toContain('ch=#general');
    expect(reason).not.toContain('flags=');
  });

  test('strips leading # and whitespace from channel name', () => {
    const reason = buildAuditReason({
      score: 50,
      channelName: '  #my-channel  ',
    });
    expect(reason).toContain('ch=#my-channel');
  });

  test('truncates to 512 chars (Discord audit-log header cap)', () => {
    const longFlags = Array(200).fill('verysuspiciousflag');
    const reason = buildAuditReason({
      score: 99,
      channelName: 'test',
      flags: longFlags,
      messageId: '1',
    });
    expect(reason.length).toBeLessThanOrEqual(512);
  });
});

describe('flagsTriggered', () => {
  test('returns only true-valued keys', () => {
    const triggered = flagsTriggered({
      newAccount: true,
      newMember: false,
      phishingUrl: true,
      noRoles: undefined,
    });
    expect(triggered.sort()).toEqual(['newAccount', 'phishingUrl'].sort());
  });

  test('returns empty array for null/undefined input', () => {
    expect(flagsTriggered(null)).toEqual([]);
    expect(flagsTriggered(undefined)).toEqual([]);
  });

  test('returns empty array when no flags are true', () => {
    expect(flagsTriggered({ a: false, b: false })).toEqual([]);
  });
});
