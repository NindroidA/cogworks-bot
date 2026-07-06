/**
 * AutoMod Backup/Restore Handler
 *
 * Exports AutoMod rules as JSON (sent via DM) and restores from JSON attachments.
 */

import {
  AttachmentBuilder,
  type AutoModerationActionType,
  type AutoModerationRuleEventType,
  type AutoModerationRuleTriggerType,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import {
  awaitConfirmation,
  enhancedLogger,
  formatLang,
  handleInteractionError,
  LogCategory,
  lang,
  replyEphemeralError,
} from '../../../utils';
import {
  createAutoModRule,
  deserializeRules,
  fetchAutoModRules,
  MAX_AUTOMOD_RULES,
  serializeRules,
} from '../../../utils/automod/helpers';
import type { AutoModRuleConfig } from '../../../utils/automod/templates';

const tl = lang.automod;

export async function backupHandler(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'export':
      await handleBackup(interaction);
      break;
    case 'restore':
      await handleRestore(interaction);
      break;
  }
}

async function handleBackup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const rules = await fetchAutoModRules(guild);

    if (rules.size === 0) {
      await replyEphemeralError(interaction, tl.backup.empty);
      return;
    }

    const backup = serializeRules(rules, guild);
    const json = JSON.stringify(backup, null, 2);
    const fileName = tl.backup.fileName.replace('{0}', guild.id);

    const attachment = new AttachmentBuilder(Buffer.from(json, 'utf-8'), {
      name: fileName,
    });

    // Try to DM the user
    try {
      await interaction.user.send({
        content: `AutoMod backup for **${guild.name}** (${rules.size} rules)`,
        files: [attachment],
      });

      enhancedLogger.info(`AutoMod backup exported for guild ${guild.id}`, LogCategory.COMMAND_EXECUTION, {
        guildId: guild.id,
        ruleCount: rules.size,
        userId: interaction.user.id,
      });

      await interaction.editReply({ content: tl.backup.success });
    } catch {
      await replyEphemeralError(interaction, tl.backup.dmFailed);
    }
  } catch (error) {
    await handleInteractionError(interaction, error, tl.backup.error);
  }
}

async function handleRestore(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const attachment = interaction.options.getAttachment('file', true);

  if (!attachment.name.endsWith('.json')) {
    await replyEphemeralError(interaction, tl.restore.invalidJson);
    return;
  }

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    // Download the file
    const response = await fetch(attachment.url);
    const text = await response.text();

    const backup = deserializeRules(text);
    if (!backup) {
      await replyEphemeralError(interaction, tl.restore.invalidFormat);
      return;
    }

    if (backup.rules.length === 0) {
      await replyEphemeralError(interaction, tl.restore.invalidFormat);
      return;
    }

    // Check available slots
    const existingRules = await fetchAutoModRules(guild);
    const availableSlots = MAX_AUTOMOD_RULES - existingRules.size;

    if (backup.rules.length > availableSlots) {
      await interaction.editReply({
        content: formatLang(tl.restore.wouldExceedLimit, backup.rules.length, availableSlots),
      });
      return;
    }

    // Confirmation — awaitConfirmation owns the cancel/timeout handling and
    // works post-deferReply since v3.14.6 (this flow escaped the v3.0.4 and
    // v3.1.34 consolidations because the helper couldn't edit a deferred reply).
    const result = await awaitConfirmation(interaction, {
      message: formatLang(tl.restore.confirmMessage, backup.rules.length),
      confirmLabel: tl.restore.confirmLabel,
      confirmStyle: ButtonStyle.Primary,
      idPrefix: 'automod_restore',
    });
    if (!result) return;

    let created = 0;
    for (const serializedRule of backup.rules) {
      try {
        const ruleConfig: AutoModRuleConfig = {
          name: serializedRule.name,
          eventType: serializedRule.eventType as AutoModerationRuleEventType,
          triggerType: serializedRule.triggerType as AutoModerationRuleTriggerType,
          triggerMetadata: {
            keywordFilter: serializedRule.triggerMetadata?.keywordFilter,
            regexPatterns: serializedRule.triggerMetadata?.regexPatterns,
            mentionTotalLimit: serializedRule.triggerMetadata?.mentionTotalLimit,
            mentionRaidProtectionEnabled: serializedRule.triggerMetadata?.mentionRaidProtectionEnabled,
          },
          actions: serializedRule.actions.map(a => ({
            type: a.type as AutoModerationActionType,
            metadata: a.metadata
              ? {
                  durationSeconds: a.metadata.durationSeconds,
                  customMessage: a.metadata.customMessage,
                }
              : undefined,
          })),
          enabled: serializedRule.enabled,
        };

        await createAutoModRule(guild, ruleConfig);
        created++;
      } catch (error) {
        enhancedLogger.warn(`Failed to restore rule: ${serializedRule.name}`, LogCategory.COMMAND_EXECUTION, {
          guildId: guild.id,
          error: String(error),
        });
      }
    }

    enhancedLogger.info(`AutoMod rules restored: ${created}/${backup.rules.length}`, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      userId: interaction.user.id,
    });

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(tl.restore.title)
      .setDescription(formatLang(tl.restore.success, created));

    await result.interaction.editReply({
      content: '',
      embeds: [embed],
      components: [],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.restore.error);
  }
}
