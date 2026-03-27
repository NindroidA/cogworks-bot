/**
 * AutoMod Backup/Restore Handler
 *
 * Exports AutoMod rules as JSON (sent via DM) and restores from JSON attachments.
 */

import {
  ActionRowBuilder,
  AttachmentBuilder,
  type AutoModerationActionType,
  type AutoModerationRuleEventType,
  type AutoModerationRuleTriggerType,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { enhancedLogger, handleInteractionError, LANGF, LogCategory, lang } from '../../../utils';
import {
  createAutoModRule,
  deserializeRules,
  fetchAutoModRules,
  MAX_AUTOMOD_RULES,
  serializeRules,
} from '../../../utils/automod/helpers';
import type { AutoModRuleConfig } from '../../../utils/automod/templates';

const tl = lang.automod;

export const backupHandler = async (_client: Client, interaction: ChatInputCommandInteraction): Promise<void> => {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'export':
      await handleBackup(interaction);
      break;
    case 'restore':
      await handleRestore(interaction);
      break;
  }
};

async function handleBackup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const rules = await fetchAutoModRules(guild);

    if (rules.size === 0) {
      await interaction.editReply({ content: tl.backup.empty });
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
      await interaction.editReply({ content: tl.backup.dmFailed });
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
    await interaction.reply({
      content: tl.restore.invalidJson,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    // Download the file
    const response = await fetch(attachment.url);
    const text = await response.text();

    const backup = deserializeRules(text);
    if (!backup) {
      await interaction.editReply({ content: tl.restore.invalidFormat });
      return;
    }

    if (backup.rules.length === 0) {
      await interaction.editReply({ content: tl.restore.invalidFormat });
      return;
    }

    // Check available slots
    const existingRules = await fetchAutoModRules(guild);
    const availableSlots = MAX_AUTOMOD_RULES - existingRules.size;

    if (backup.rules.length > availableSlots) {
      await interaction.editReply({
        content: LANGF(tl.restore.wouldExceedLimit, backup.rules.length, availableSlots),
      });
      return;
    }

    // Confirmation
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_restore_confirm')
        .setLabel('Confirm Restore')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('automod_restore_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    const confirmReply = await interaction.editReply({
      content: LANGF(tl.restore.confirmMessage, backup.rules.length),
      components: [row],
    });

    try {
      const buttonInteraction = await confirmReply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 30_000,
      });

      if (buttonInteraction.customId === 'automod_restore_cancel') {
        await buttonInteraction.update({
          content: lang.errors.cancelled,
          components: [],
        });
        return;
      }

      await buttonInteraction.deferUpdate();

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
        .setDescription(LANGF(tl.restore.success, created));

      await interaction.editReply({
        content: '',
        embeds: [embed],
        components: [],
      });
    } catch {
      await interaction.editReply({
        content: lang.errors.cancelled,
        components: [],
      });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, tl.restore.error);
  }
}
