/**
 * AutoMod Helpers
 *
 * Wraps Discord.js AutoMod API methods for consistent error handling
 * and provides serialization for backup/restore.
 */

import type {
  AutoModerationActionMetadataOptions,
  AutoModerationActionOptions,
  AutoModerationRule,
  AutoModerationRuleCreateOptions,
  Guild,
} from 'discord.js';
import { AutoModerationActionType, AutoModerationRuleTriggerType, type Collection } from 'discord.js';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { AutoModRuleConfig } from './templates';

/** Discord's maximum AutoMod rules per guild */
export const MAX_AUTOMOD_RULES = 6;
/** Discord's maximum keywords per rule */
export const MAX_KEYWORDS_PER_RULE = 1000;
/** Discord's maximum regex patterns per rule */
export const MAX_REGEX_PER_RULE = 10;
/** Discord's maximum regex pattern length */
export const MAX_REGEX_LENGTH = 75;

/**
 * Fetch all AutoMod rules for a guild.
 */
export async function fetchAutoModRules(guild: Guild): Promise<Collection<string, AutoModerationRule>> {
  try {
    return await guild.autoModerationRules.fetch();
  } catch (error) {
    enhancedLogger.error('Failed to fetch AutoMod rules', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
    });
    throw error;
  }
}

/**
 * Create a new AutoMod rule on a guild.
 */
export async function createAutoModRule(guild: Guild, config: AutoModRuleConfig): Promise<AutoModerationRule> {
  try {
    const options: AutoModerationRuleCreateOptions = {
      name: config.name,
      eventType: config.eventType,
      triggerType: config.triggerType,
      triggerMetadata: config.triggerMetadata ?? {},
      actions: config.actions.map(a => {
        const action: AutoModerationActionOptions = {
          type: a.type,
        };
        if (a.metadata) {
          const meta: AutoModerationActionMetadataOptions = {};
          if (a.metadata.durationSeconds !== undefined) {
            meta.durationSeconds = a.metadata.durationSeconds;
          }
          if (a.metadata.customMessage !== undefined) {
            meta.customMessage = a.metadata.customMessage;
          }
          action.metadata = meta;
        }
        return action;
      }),
      enabled: config.enabled,
    };

    return await guild.autoModerationRules.create(options);
  } catch (error) {
    enhancedLogger.error('Failed to create AutoMod rule', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      ruleName: config.name,
    });
    throw error;
  }
}

/**
 * Delete an AutoMod rule from a guild.
 */
export async function deleteAutoModRule(guild: Guild, ruleId: string): Promise<void> {
  try {
    await guild.autoModerationRules.delete(ruleId);
  } catch (error) {
    enhancedLogger.error('Failed to delete AutoMod rule', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      ruleId,
    });
    throw error;
  }
}

/** Serialized format for a single AutoMod rule (used in backup/restore) */
export interface SerializedAutoModRule {
  name: string;
  eventType: number;
  triggerType: number;
  triggerMetadata: {
    keywordFilter?: string[];
    regexPatterns?: string[];
    mentionTotalLimit?: number;
    mentionRaidProtectionEnabled?: boolean;
    allowList?: string[];
  };
  actions: {
    type: number;
    metadata?: {
      durationSeconds?: number;
      customMessage?: string;
      channelId?: string;
    };
  }[];
  enabled: boolean;
  exemptRoles: string[];
  exemptChannels: string[];
}

export interface AutoModBackup {
  version: 1;
  guildId: string;
  guildName: string;
  exportedAt: string;
  rules: SerializedAutoModRule[];
}

/**
 * Serialize a collection of AutoMod rules to a JSON-safe backup object.
 */
export function serializeRules(rules: Collection<string, AutoModerationRule>, guild: Guild): AutoModBackup {
  const serialized: SerializedAutoModRule[] = rules.map(rule => ({
    name: rule.name,
    eventType: rule.eventType,
    triggerType: rule.triggerType,
    triggerMetadata: {
      keywordFilter: [...(rule.triggerMetadata.keywordFilter ?? [])],
      regexPatterns: [...(rule.triggerMetadata.regexPatterns ?? [])],
      mentionTotalLimit: rule.triggerMetadata.mentionTotalLimit ?? undefined,
      mentionRaidProtectionEnabled: rule.triggerMetadata.mentionRaidProtectionEnabled ?? undefined,
      allowList: [...(rule.triggerMetadata.allowList ?? [])],
    },
    actions: rule.actions.map(a => ({
      type: a.type,
      metadata: {
        durationSeconds: a.metadata.durationSeconds ?? undefined,
        customMessage: a.metadata.customMessage ?? undefined,
        channelId: a.metadata.channelId ?? undefined,
      },
    })),
    enabled: rule.enabled,
    exemptRoles: rule.exemptRoles.map(r => r.id),
    exemptChannels: rule.exemptChannels.map(c => c.id),
  }));

  return {
    version: 1,
    guildId: guild.id,
    guildName: guild.name,
    exportedAt: new Date().toISOString(),
    rules: serialized,
  };
}

/**
 * Parse and validate a JSON string as an AutoMod backup.
 * Returns null if the format is invalid.
 */
export function deserializeRules(json: string): AutoModBackup | null {
  try {
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.rules)) return null;

    // Validate each rule has required fields
    for (const rule of parsed.rules) {
      if (typeof rule.name !== 'string') return null;
      if (typeof rule.eventType !== 'number') return null;
      if (typeof rule.triggerType !== 'number') return null;
      if (!Array.isArray(rule.actions)) return null;
      if (typeof rule.enabled !== 'boolean') return null;
    }

    return parsed as AutoModBackup;
  } catch {
    return null;
  }
}

/**
 * Get a human-readable label for a trigger type.
 */
export function getTriggerTypeLabel(triggerType: AutoModerationRuleTriggerType): string {
  switch (triggerType) {
    case AutoModerationRuleTriggerType.Keyword:
      return 'Keyword Filter';
    case AutoModerationRuleTriggerType.Spam:
      return 'Spam Filter';
    case AutoModerationRuleTriggerType.KeywordPreset:
      return 'Keyword Preset';
    case AutoModerationRuleTriggerType.MentionSpam:
      return 'Mention Spam';
    default:
      return 'Unknown';
  }
}

/**
 * Get a human-readable label for an action type.
 */
export function getActionTypeLabel(actionType: AutoModerationActionType): string {
  switch (actionType) {
    case AutoModerationActionType.BlockMessage:
      return 'Block Message';
    case AutoModerationActionType.SendAlertMessage:
      return 'Alert';
    case AutoModerationActionType.Timeout:
      return 'Timeout';
    case AutoModerationActionType.BlockMemberInteraction:
      return 'Block Interaction';
    default:
      return 'Unknown';
  }
}
