/**
 * AutoMod Keyword & Regex & Exempt Handler
 *
 * Manages keywords, regex patterns, and exemptions on Discord AutoMod rules.
 */

import {
  AutoModerationRuleTriggerType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from 'discord.js';
import { enhancedLogger, handleInteractionError, LANGF, LogCategory, lang } from '../../../utils';
import {
  fetchAutoModRules,
  MAX_KEYWORDS_PER_RULE,
  MAX_REGEX_LENGTH,
  MAX_REGEX_PER_RULE,
} from '../../../utils/automod/helpers';

const tl = lang.automod;

/**
 * Validate regex syntax without executing against input.
 * Pattern is already length-bounded (max 75 chars) so compilation is safe.
 */
function validateRegexSyntax(pattern: string): boolean {
  try {
    // Only compiles the regex to check syntax; does not match against any string.
    // Pattern length is capped at MAX_REGEX_LENGTH (75) before this is called.
    void new RegExp(pattern); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp
    return true;
  } catch {
    return false;
  }
}

export const keywordHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const group = interaction.options.getSubcommandGroup(true);
  const subcommand = interaction.options.getSubcommand();

  switch (group) {
    case 'keyword':
      if (subcommand === 'add') await handleKeywordAdd(interaction);
      else await handleKeywordRemove(interaction);
      break;
    case 'regex':
      if (subcommand === 'add') await handleRegexAdd(interaction);
      else await handleRegexRemove(interaction);
      break;
    case 'exempt':
      if (subcommand === 'add') await handleExemptAdd(interaction);
      else await handleExemptRemove(interaction);
      break;
  }
};

/* =========================================================================
 * Keyword add/remove
 * ========================================================================= */

async function handleKeywordAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);
  const keyword = interaction.options.getString('keyword', true).toLowerCase().trim();

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.error.ruleNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (rule.triggerType !== AutoModerationRuleTriggerType.Keyword) {
      await interaction.reply({
        content: tl.keyword.add.ruleNotKeyword,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const existingKeywords = rule.triggerMetadata.keywordFilter ?? [];

    if (existingKeywords.length >= MAX_KEYWORDS_PER_RULE) {
      await interaction.reply({
        content: tl.keyword.add.limitReached,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (existingKeywords.includes(keyword)) {
      await interaction.reply({
        content: LANGF(tl.keyword.add.alreadyExists, keyword),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await rule.edit({
      triggerMetadata: {
        ...rule.triggerMetadata,
        keywordFilter: [...existingKeywords, keyword],
      },
    });

    enhancedLogger.info(
      `AutoMod keyword added to rule ${rule.name}: ${keyword}`,
      LogCategory.COMMAND_EXECUTION,
      { guildId: guild.id, ruleId, userId: interaction.user.id },
    );

    await interaction.reply({
      content: LANGF(tl.keyword.add.success, keyword, rule.name),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.keyword.error);
  }
}

async function handleKeywordRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);
  const keyword = interaction.options.getString('keyword', true).toLowerCase().trim();

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.error.ruleNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (rule.triggerType !== AutoModerationRuleTriggerType.Keyword) {
      await interaction.reply({
        content: tl.keyword.remove.ruleNotKeyword,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const existingKeywords = rule.triggerMetadata.keywordFilter ?? [];
    const index = existingKeywords.indexOf(keyword);

    if (index === -1) {
      await interaction.reply({
        content: LANGF(tl.keyword.remove.notFound, keyword),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const updatedKeywords = existingKeywords.filter(k => k !== keyword);

    await rule.edit({
      triggerMetadata: {
        ...rule.triggerMetadata,
        keywordFilter: updatedKeywords,
      },
    });

    enhancedLogger.info(
      `AutoMod keyword removed from rule ${rule.name}: ${keyword}`,
      LogCategory.COMMAND_EXECUTION,
      { guildId: guild.id, ruleId, userId: interaction.user.id },
    );

    await interaction.reply({
      content: LANGF(tl.keyword.remove.success, keyword, rule.name),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.keyword.error);
  }
}

/* =========================================================================
 * Regex add/remove
 * ========================================================================= */

async function handleRegexAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);
  const pattern = interaction.options.getString('pattern', true);

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.error.ruleNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (rule.triggerType !== AutoModerationRuleTriggerType.Keyword) {
      await interaction.reply({
        content: tl.regex.add.ruleNotKeyword,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (pattern.length > MAX_REGEX_LENGTH) {
      await interaction.reply({
        content: LANGF(tl.regex.add.tooLong, pattern.length),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate regex syntax (length already capped at 75 chars by MAX_REGEX_LENGTH check above)
    // Safe: pattern is length-bounded so ReDoS complexity is bounded
    const isValidRegex = validateRegexSyntax(pattern);
    if (!isValidRegex) {
      await interaction.reply({
        content: tl.regex.add.invalid,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const existingPatterns = rule.triggerMetadata.regexPatterns ?? [];

    if (existingPatterns.length >= MAX_REGEX_PER_RULE) {
      await interaction.reply({
        content: tl.regex.add.limitReached,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (existingPatterns.includes(pattern)) {
      await interaction.reply({
        content: tl.regex.add.alreadyExists,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await rule.edit({
      triggerMetadata: {
        ...rule.triggerMetadata,
        regexPatterns: [...existingPatterns, pattern],
      },
    });

    enhancedLogger.info(`AutoMod regex added to rule ${rule.name}`, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      ruleId,
      userId: interaction.user.id,
    });

    await interaction.reply({
      content: LANGF(tl.regex.add.success, pattern, rule.name),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.regex.error);
  }
}

async function handleRegexRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);
  const pattern = interaction.options.getString('pattern', true);

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.error.ruleNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (rule.triggerType !== AutoModerationRuleTriggerType.Keyword) {
      await interaction.reply({
        content: tl.regex.remove.ruleNotKeyword,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const existingPatterns = rule.triggerMetadata.regexPatterns ?? [];

    if (!existingPatterns.includes(pattern)) {
      await interaction.reply({
        content: tl.regex.remove.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await rule.edit({
      triggerMetadata: {
        ...rule.triggerMetadata,
        regexPatterns: existingPatterns.filter(p => p !== pattern),
      },
    });

    enhancedLogger.info(
      `AutoMod regex removed from rule ${rule.name}`,
      LogCategory.COMMAND_EXECUTION,
      { guildId: guild.id, ruleId, userId: interaction.user.id },
    );

    await interaction.reply({
      content: LANGF(tl.regex.remove.success, pattern, rule.name),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.regex.error);
  }
}

/* =========================================================================
 * Exempt add/remove
 * ========================================================================= */

async function handleExemptAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');

  if (!role && !channel) {
    await interaction.reply({
      content: tl.exempt.add.specifyRoleOrChannel,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.error.ruleNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const exemptRoles = rule.exemptRoles.map(r => r.id);
    const exemptChannels = rule.exemptChannels.map(c => c.id);

    if (role) {
      if (exemptRoles.includes(role.id)) {
        await interaction.reply({
          content: tl.exempt.add.alreadyExempt,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      exemptRoles.push(role.id);
    }

    if (channel) {
      if (exemptChannels.includes(channel.id)) {
        await interaction.reply({
          content: tl.exempt.add.alreadyExempt,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      exemptChannels.push(channel.id);
    }

    await rule.edit({ exemptRoles, exemptChannels });

    enhancedLogger.info(
      `AutoMod exemption added to rule ${rule.name}`,
      LogCategory.COMMAND_EXECUTION,
      {
        guildId: guild.id,
        ruleId,
        userId: interaction.user.id,
        exemptRole: role?.id,
        exemptChannel: channel?.id,
      },
    );

    await interaction.reply({
      content: LANGF(tl.exempt.add.success, rule.name),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.exempt.error);
  }
}

async function handleExemptRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');

  if (!role && !channel) {
    await interaction.reply({
      content: tl.exempt.remove.specifyRoleOrChannel,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.error.ruleNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    let exemptRoles = rule.exemptRoles.map(r => r.id);
    let exemptChannels = rule.exemptChannels.map(c => c.id);

    if (role) {
      if (!exemptRoles.includes(role.id)) {
        await interaction.reply({
          content: tl.exempt.remove.notExempt,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      exemptRoles = exemptRoles.filter(id => id !== role.id);
    }

    if (channel) {
      if (!exemptChannels.includes(channel.id)) {
        await interaction.reply({
          content: tl.exempt.remove.notExempt,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      exemptChannels = exemptChannels.filter(id => id !== channel.id);
    }

    await rule.edit({ exemptRoles, exemptChannels });

    enhancedLogger.info(
      `AutoMod exemption removed from rule ${rule.name}`,
      LogCategory.COMMAND_EXECUTION,
      {
        guildId: guild.id,
        ruleId,
        userId: interaction.user.id,
        exemptRole: role?.id,
        exemptChannel: channel?.id,
      },
    );

    await interaction.reply({
      content: LANGF(tl.exempt.remove.success, rule.name),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.exempt.error);
  }
}
