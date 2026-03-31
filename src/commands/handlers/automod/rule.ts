/**
 * AutoMod Rule CRUD Handler
 *
 * Handles create, edit, delete, and list operations for Discord AutoMod rules.
 */

import {
  ActionRowBuilder,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  awaitConfirmation,
  enhancedLogger,
  handleInteractionError,
  LANGF,
  LogCategory,
  lang,
  showAndAwaitModal,
} from '../../../utils';
import {
  createAutoModRule,
  deleteAutoModRule,
  fetchAutoModRules,
  getActionTypeLabel,
  getTriggerTypeLabel,
  MAX_AUTOMOD_RULES,
} from '../../../utils/automod/helpers';

const tl = lang.automod;

export async function ruleHandler(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await handleCreate(interaction);
      break;
    case 'edit':
      await handleEdit(interaction);
      break;
    case 'delete':
      await handleDelete(interaction);
      break;
    case 'list':
      await handleList(interaction);
      break;
  }
}

async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const name = interaction.options.getString('name', true);
  const type = interaction.options.getString('type', true);

  try {
    // Check rule count
    const existingRules = await fetchAutoModRules(guild);
    if (existingRules.size >= MAX_AUTOMOD_RULES) {
      await interaction.reply({
        content: tl.rule.create.limitReached,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Map type string to trigger type
    let triggerType: AutoModerationRuleTriggerType;
    const triggerMetadata: Record<string, unknown> = {};

    switch (type) {
      case 'keyword':
        triggerType = AutoModerationRuleTriggerType.Keyword;
        triggerMetadata.keywordFilter = [];
        break;
      case 'mention-spam':
        triggerType = AutoModerationRuleTriggerType.MentionSpam;
        triggerMetadata.mentionTotalLimit = 5;
        break;
      case 'spam':
        triggerType = AutoModerationRuleTriggerType.Spam;
        break;
      default:
        triggerType = AutoModerationRuleTriggerType.Keyword;
        triggerMetadata.keywordFilter = [];
    }

    const rule = await createAutoModRule(guild, {
      name,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType,
      triggerMetadata: triggerMetadata as {
        keywordFilter?: string[];
        mentionTotalLimit?: number;
      },
      actions: [
        {
          type: AutoModerationActionType.BlockMessage,
          metadata: {
            customMessage: 'Your message was blocked by AutoMod.',
          },
        },
      ],
      enabled: true,
    });

    enhancedLogger.info(`AutoMod rule created: ${rule.name}`, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      ruleId: rule.id,
      userId: interaction.user.id,
    });

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(tl.rule.create.title)
      .setDescription(LANGF(tl.rule.create.success, name))
      .addFields(
        { name: 'Type', value: getTriggerTypeLabel(triggerType), inline: true },
        { name: 'Status', value: 'Enabled', inline: true },
      );

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.rule.create.error);
  }
}

async function handleEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.rule.edit.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Show modal to edit rule name
    const modal = new ModalBuilder().setCustomId(`automod_rule_edit_${ruleId}`).setTitle(tl.rule.edit.modalTitle);

    const nameInput = new TextInputBuilder()
      .setCustomId('rule_name')
      .setLabel(tl.rule.edit.nameLabel)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(tl.rule.edit.namePlaceholder)
      .setValue(rule.name)
      .setRequired(true)
      .setMaxLength(100);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput));

    const modalSubmit = await showAndAwaitModal(interaction, modal);
    if (!modalSubmit) return;

    const newName = modalSubmit.fields.getTextInputValue('rule_name');

    await rule.edit({ name: newName });

    enhancedLogger.info(`AutoMod rule edited: ${newName}`, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      ruleId: rule.id,
      userId: interaction.user.id,
    });

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(tl.rule.edit.title)
      .setDescription(LANGF(tl.rule.edit.success, newName));

    await modalSubmit.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.rule.edit.error);
  }
}

async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const ruleId = interaction.options.getString('rule', true);

  try {
    const rules = await fetchAutoModRules(guild);
    const rule = rules.get(ruleId);

    if (!rule) {
      await interaction.reply({
        content: tl.rule.delete.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Confirmation
    const result = await awaitConfirmation(interaction, {
      message: LANGF(tl.rule.delete.confirmMessage, rule.name),
      confirmLabel: 'Confirm Delete',
      confirmStyle: ButtonStyle.Danger,
    });
    if (!result) return;

    await deleteAutoModRule(guild, ruleId);

    enhancedLogger.info(`AutoMod rule deleted: ${rule.name}`, LogCategory.COMMAND_EXECUTION, {
      guildId: guild.id,
      ruleId,
      userId: interaction.user.id,
    });

    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle(tl.rule.delete.title)
      .setDescription(LANGF(tl.rule.delete.success, rule.name));

    await result.interaction.editReply({
      embeds: [embed],
      content: '',
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.rule.delete.error);
  }
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  try {
    const rules = await fetchAutoModRules(guild);

    if (rules.size === 0) {
      await interaction.reply({
        content: tl.rule.list.empty,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle(tl.rule.list.title)
      .setFooter({ text: LANGF(tl.rule.list.footer, rules.size) });

    for (const rule of rules.values()) {
      const lines: string[] = [];
      lines.push(`**Type:** ${getTriggerTypeLabel(rule.triggerType)}`);
      lines.push(`**Status:** ${rule.enabled ? tl.rule.list.enabled : tl.rule.list.disabled}`);

      if (rule.triggerType === AutoModerationRuleTriggerType.Keyword && rule.triggerMetadata.keywordFilter) {
        lines.push(LANGF(tl.rule.list.keywords, rule.triggerMetadata.keywordFilter.length));
      }

      if (rule.triggerType === AutoModerationRuleTriggerType.Keyword && rule.triggerMetadata.regexPatterns) {
        lines.push(LANGF(tl.rule.list.regexPatterns, rule.triggerMetadata.regexPatterns.length));
      }

      if (rule.triggerType === AutoModerationRuleTriggerType.MentionSpam && rule.triggerMetadata.mentionTotalLimit) {
        lines.push(LANGF(tl.rule.list.mentionLimit, rule.triggerMetadata.mentionTotalLimit));
      }

      if (rule.exemptRoles.size > 0) {
        lines.push(LANGF(tl.rule.list.exemptRoles, rule.exemptRoles.size));
      }

      if (rule.exemptChannels.size > 0) {
        lines.push(LANGF(tl.rule.list.exemptChannels, rule.exemptChannels.size));
      }

      const actionLabels = rule.actions.map(a => getActionTypeLabel(a.type)).join(', ');
      lines.push(LANGF(tl.rule.list.actions, actionLabels));

      embed.addFields({ name: rule.name, value: lines.join('\n') });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.fetchFailed);
  }
}
