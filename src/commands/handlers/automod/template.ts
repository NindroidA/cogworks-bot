/**
 * AutoMod Template Handler
 *
 * Applies predefined AutoMod templates to a guild.
 */

import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  enhancedLogger,
  formatLang,
  handleInteractionError,
  LogCategory,
  lang,
  replyEphemeralError,
} from '../../../utils';
import { createAutoModRule, fetchAutoModRules, MAX_AUTOMOD_RULES } from '../../../utils/automod/helpers';
import { AUTOMOD_TEMPLATES } from '../../../utils/automod/templates';

const tl = lang.automod;

export async function templateHandler(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const templateId = interaction.options.getString('template', true);
  const template = AUTOMOD_TEMPLATES[templateId];

  if (!template) {
    await replyEphemeralError(interaction, tl.template.notFound);
    return;
  }

  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const existingRules = await fetchAutoModRules(guild);
    const availableSlots = MAX_AUTOMOD_RULES - existingRules.size;

    if (availableSlots <= 0) {
      await interaction.editReply({
        content: formatLang(tl.template.wouldExceedLimit, template.rules.length, 0),
      });
      return;
    }

    if (template.rules.length > availableSlots) {
      await interaction.editReply({
        content: formatLang(tl.template.wouldExceedLimit, template.rules.length, availableSlots),
      });
      return;
    }

    let created = 0;
    for (const ruleConfig of template.rules) {
      try {
        await createAutoModRule(guild, ruleConfig);
        created++;
      } catch (error) {
        enhancedLogger.warn(`Failed to create template rule: ${ruleConfig.name}`, LogCategory.COMMAND_EXECUTION, {
          guildId: guild.id,
          error: String(error),
        });
        break;
      }
    }

    enhancedLogger.info(
      `AutoMod template applied: ${template.name} (${created}/${template.rules.length} rules)`,
      LogCategory.COMMAND_EXECUTION,
      {
        guildId: guild.id,
        templateId,
        userId: interaction.user.id,
      },
    );

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(tl.template.title)
      .setDescription(
        created === template.rules.length
          ? formatLang(tl.template.success, template.name, created)
          : formatLang(tl.template.partialSuccess, template.name, created, template.rules.length),
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.template.error);
  }
}
