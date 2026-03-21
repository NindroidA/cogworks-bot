/**
 * AutoMod Templates
 *
 * Predefined rule configurations for common moderation scenarios.
 * Each template defines one or more AutoMod rules using Discord's native API types.
 */

import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
} from 'discord.js';

export interface AutoModRuleConfig {
  name: string;
  eventType: AutoModerationRuleEventType;
  triggerType: AutoModerationRuleTriggerType;
  triggerMetadata?: {
    keywordFilter?: string[];
    regexPatterns?: string[];
    mentionTotalLimit?: number;
    mentionRaidProtectionEnabled?: boolean;
  };
  actions: {
    type: AutoModerationActionType;
    metadata?: {
      /** Duration in seconds for timeout action */
      durationSeconds?: number;
      /** Custom message shown to the user */
      customMessage?: string;
    };
  }[];
  enabled: boolean;
}

export interface AutoModTemplate {
  id: string;
  name: string;
  description: string;
  rules: AutoModRuleConfig[];
}

/**
 * Anti-Spam template
 * Blocks common spam phrases and limits excessive mentions.
 */
const antiSpamTemplate: AutoModTemplate = {
  id: 'anti-spam',
  name: 'Anti-Spam',
  description: 'Blocks common spam phrases and limits excessive mentions',
  rules: [
    {
      name: 'Anti-Spam: Keyword Filter',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        keywordFilter: [
          'free nitro',
          'free discord nitro',
          'claim your nitro',
          'steam gift',
          'free gift',
          'click here to claim',
          'congratulations you won',
          'you have been selected',
          'we are giving away',
          'dm me for free',
          'check my bio',
          'check my profile',
          'link in bio',
          'earn money fast',
          'make money online',
          'work from home easy',
          'join my server for',
          'discord.gift/',
        ],
      },
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: {
            customMessage: 'Your message was blocked for containing spam content.',
          },
        },
      ],
      enabled: true,
    },
    {
      name: 'Anti-Spam: Mention Spam',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: {
        mentionTotalLimit: 5,
        mentionRaidProtectionEnabled: true,
      },
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: {
            customMessage: 'Your message was blocked for mentioning too many users.',
          },
        },
        {
          type: AutoModerationActionType.Timeout,
          metadata: {
            durationSeconds: 300,
          },
        },
      ],
      enabled: true,
    },
  ],
};

/**
 * Anti-Phishing template
 * Detects phishing URLs and Discord scam patterns using regex.
 */
const antiPhishingTemplate: AutoModTemplate = {
  id: 'anti-phishing',
  name: 'Anti-Phishing',
  description: 'Detects phishing URLs and Discord scam patterns',
  rules: [
    {
      name: 'Anti-Phishing: Scam URLs',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        keywordFilter: [
          'discordgift.site',
          'discord-nitro.gift',
          'steamcommunity.ru',
          'steampowered.ru',
          'discordapp.gift',
          'discord-give.com',
          'dlscord.gift',
          'disc0rd.gift',
          'disocrd.gift',
          'discorde.gift',
          'nitro-gift.com',
        ],
        regexPatterns: [
          'disc[o0]rd[\\-\\.]?(?:gift|nitro|app)[\\-\\.]\\w+',
          'stea[mn]c[o0]mmun[il1]ty\\.\\w+',
          'https?://[\\w.-]*(?:n[il1]tro|g[il1]ft)[\\w.-]*\\.',
        ],
      },
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: {
            customMessage: 'Your message was blocked for containing a suspected phishing link.',
          },
        },
        {
          type: AutoModerationActionType.Timeout,
          metadata: {
            durationSeconds: 600,
          },
        },
      ],
      enabled: true,
    },
  ],
};

/**
 * Family-Friendly template
 * Blocks profanity and slur variants using keyword and regex filters.
 */
const familyFriendlyTemplate: AutoModTemplate = {
  id: 'family-friendly',
  name: 'Family-Friendly',
  description: 'Blocks profanity and offensive content',
  rules: [
    {
      name: 'Family-Friendly: Profanity Filter',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        keywordFilter: [
          'fuck',
          'shit',
          'bitch',
          'ass',
          'damn',
          'bastard',
          'crap',
          'dick',
          'piss',
          'whore',
          'slut',
          'stfu',
          'gtfo',
          'wtf',
          'fml',
        ],
        regexPatterns: [
          'f+[u\\*]+[c\\*]+[k\\*]+',
          's+[h\\*]+[i\\*]+[t\\*]+',
          'b+[i\\*]+[t\\*]+[c\\*]+[h\\*]+',
        ],
      },
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: {
            customMessage: 'Your message was blocked for containing inappropriate language.',
          },
        },
      ],
      enabled: true,
    },
  ],
};

/**
 * Gaming template
 * Blocks trade scams, RWT, and account selling common in gaming communities.
 */
const gamingTemplate: AutoModTemplate = {
  id: 'gaming',
  name: 'Gaming',
  description: 'Blocks trade scams, RWT, and account selling in gaming communities',
  rules: [
    {
      name: 'Gaming: Scam Prevention',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        keywordFilter: [
          'selling account',
          'buy account',
          'account for sale',
          'cheap accounts',
          'rwt',
          'real world trading',
          'gold selling',
          'buy gold cheap',
          'boosting service',
          'rank boost',
          'elo boost',
          'mmr boost',
          'power leveling',
          'powerleveling',
          'buy coins',
          'sell coins',
          'cheap credits',
          'game hack',
          'free cheat',
          'aimbot',
          'wallhack',
          'esp hack',
          'mod menu',
          'god mode hack',
        ],
      },
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: {
            customMessage:
              'Your message was blocked for containing prohibited trading/scam content.',
          },
        },
      ],
      enabled: true,
    },
  ],
};

/** All available AutoMod templates indexed by ID */
export const AUTOMOD_TEMPLATES: Record<string, AutoModTemplate> = {
  'anti-spam': antiSpamTemplate,
  'anti-phishing': antiPhishingTemplate,
  'family-friendly': familyFriendlyTemplate,
  gaming: gamingTemplate,
};

/** Template IDs for autocomplete and validation */
export const TEMPLATE_IDS = Object.keys(AUTOMOD_TEMPLATES);
