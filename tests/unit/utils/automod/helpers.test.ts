import { describe, expect, test } from 'bun:test';
import {
  AutoModerationActionType,
  AutoModerationRuleTriggerType,
} from 'discord.js';
import {
  MAX_AUTOMOD_RULES,
  MAX_KEYWORDS_PER_RULE,
  MAX_REGEX_LENGTH,
  MAX_REGEX_PER_RULE,
  deserializeRules,
  getActionTypeLabel,
  getTriggerTypeLabel,
} from '../../../../src/utils/automod/helpers';

// ===========================================================================
// Constants
// ===========================================================================
describe('AutoMod constants', () => {
  test('MAX_AUTOMOD_RULES is 6', () => {
    expect(MAX_AUTOMOD_RULES).toBe(6);
  });

  test('MAX_KEYWORDS_PER_RULE is 1000', () => {
    expect(MAX_KEYWORDS_PER_RULE).toBe(1000);
  });

  test('MAX_REGEX_PER_RULE is 10', () => {
    expect(MAX_REGEX_PER_RULE).toBe(10);
  });

  test('MAX_REGEX_LENGTH is 75', () => {
    expect(MAX_REGEX_LENGTH).toBe(75);
  });
});

// ===========================================================================
// deserializeRules
// ===========================================================================
describe('deserializeRules()', () => {
  const validBackup = {
    version: 1,
    guildId: '123456789012345678',
    guildName: 'Test Guild',
    exportedAt: new Date().toISOString(),
    rules: [
      {
        name: 'Block Bad Words',
        eventType: 1,
        triggerType: 1,
        triggerMetadata: { keywordFilter: ['badword'] },
        actions: [{ type: 1 }],
        enabled: true,
        exemptRoles: [],
        exemptChannels: [],
      },
    ],
  };

  test('parses valid backup JSON', () => {
    const result = deserializeRules(JSON.stringify(validBackup));
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.rules).toHaveLength(1);
    expect(result!.rules[0].name).toBe('Block Bad Words');
  });

  test('parses backup with multiple rules', () => {
    const backup = {
      ...validBackup,
      rules: [
        ...validBackup.rules,
        {
          name: 'Anti Spam',
          eventType: 1,
          triggerType: 3,
          triggerMetadata: {},
          actions: [{ type: 2 }],
          enabled: false,
          exemptRoles: ['role1'],
          exemptChannels: [],
        },
      ],
    };
    const result = deserializeRules(JSON.stringify(backup));
    expect(result).not.toBeNull();
    expect(result!.rules).toHaveLength(2);
  });

  test('parses backup with empty rules array', () => {
    const backup = { ...validBackup, rules: [] };
    const result = deserializeRules(JSON.stringify(backup));
    expect(result).not.toBeNull();
    expect(result!.rules).toHaveLength(0);
  });

  test('returns null for invalid JSON', () => {
    expect(deserializeRules('not json')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(deserializeRules('')).toBeNull();
  });

  test('returns null for wrong version', () => {
    const backup = { ...validBackup, version: 2 };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('returns null for missing version', () => {
    const { version, ...noVersion } = validBackup;
    expect(deserializeRules(JSON.stringify(noVersion))).toBeNull();
  });

  test('returns null when rules is not array', () => {
    const backup = { ...validBackup, rules: 'not an array' };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('returns null for null JSON value', () => {
    expect(deserializeRules('null')).toBeNull();
  });

  test('returns null for a number', () => {
    expect(deserializeRules('42')).toBeNull();
  });

  test('returns null for a string JSON value', () => {
    expect(deserializeRules('"hello"')).toBeNull();
  });

  test('returns null when rule is missing name', () => {
    const backup = {
      ...validBackup,
      rules: [{ eventType: 1, triggerType: 1, actions: [], enabled: true }],
    };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('returns null when rule name is not a string', () => {
    const backup = {
      ...validBackup,
      rules: [
        { name: 123, eventType: 1, triggerType: 1, actions: [], enabled: true },
      ],
    };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('returns null when rule eventType is not a number', () => {
    const backup = {
      ...validBackup,
      rules: [
        { name: 'test', eventType: 'one', triggerType: 1, actions: [], enabled: true },
      ],
    };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('returns null when rule triggerType is not a number', () => {
    const backup = {
      ...validBackup,
      rules: [
        { name: 'test', eventType: 1, triggerType: 'one', actions: [], enabled: true },
      ],
    };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('returns null when rule actions is not an array', () => {
    const backup = {
      ...validBackup,
      rules: [
        { name: 'test', eventType: 1, triggerType: 1, actions: 'none', enabled: true },
      ],
    };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('returns null when rule enabled is not a boolean', () => {
    const backup = {
      ...validBackup,
      rules: [
        { name: 'test', eventType: 1, triggerType: 1, actions: [], enabled: 'yes' },
      ],
    };
    expect(deserializeRules(JSON.stringify(backup))).toBeNull();
  });

  test('preserves action metadata', () => {
    const backup = {
      ...validBackup,
      rules: [
        {
          name: 'test',
          eventType: 1,
          triggerType: 1,
          triggerMetadata: {},
          actions: [
            { type: 3, metadata: { durationSeconds: 60, customMessage: 'No spam!' } },
          ],
          enabled: true,
          exemptRoles: [],
          exemptChannels: [],
        },
      ],
    };
    const result = deserializeRules(JSON.stringify(backup));
    expect(result).not.toBeNull();
    expect(result!.rules[0].actions[0].metadata!.durationSeconds).toBe(60);
    expect(result!.rules[0].actions[0].metadata!.customMessage).toBe('No spam!');
  });
});

// ===========================================================================
// getTriggerTypeLabel
// ===========================================================================
describe('getTriggerTypeLabel()', () => {
  test('returns "Keyword Filter" for Keyword trigger', () => {
    expect(getTriggerTypeLabel(AutoModerationRuleTriggerType.Keyword)).toBe('Keyword Filter');
  });

  test('returns "Spam Filter" for Spam trigger', () => {
    expect(getTriggerTypeLabel(AutoModerationRuleTriggerType.Spam)).toBe('Spam Filter');
  });

  test('returns "Keyword Preset" for KeywordPreset trigger', () => {
    expect(getTriggerTypeLabel(AutoModerationRuleTriggerType.KeywordPreset)).toBe('Keyword Preset');
  });

  test('returns "Mention Spam" for MentionSpam trigger', () => {
    expect(getTriggerTypeLabel(AutoModerationRuleTriggerType.MentionSpam)).toBe('Mention Spam');
  });

  test('returns "Unknown" for unrecognized trigger type', () => {
    expect(getTriggerTypeLabel(999 as AutoModerationRuleTriggerType)).toBe('Unknown');
  });
});

// ===========================================================================
// getActionTypeLabel
// ===========================================================================
describe('getActionTypeLabel()', () => {
  test('returns "Block Message" for BlockMessage action', () => {
    expect(getActionTypeLabel(AutoModerationActionType.BlockMessage)).toBe('Block Message');
  });

  test('returns "Alert" for SendAlertMessage action', () => {
    expect(getActionTypeLabel(AutoModerationActionType.SendAlertMessage)).toBe('Alert');
  });

  test('returns "Timeout" for Timeout action', () => {
    expect(getActionTypeLabel(AutoModerationActionType.Timeout)).toBe('Timeout');
  });

  test('returns "Block Interaction" for BlockMemberInteraction action', () => {
    expect(getActionTypeLabel(AutoModerationActionType.BlockMemberInteraction)).toBe('Block Interaction');
  });

  test('returns "Unknown" for unrecognized action type', () => {
    expect(getActionTypeLabel(999 as AutoModerationActionType)).toBe('Unknown');
  });
});
