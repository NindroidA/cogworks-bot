import {
  ActionRowBuilder,
  type ModalBuilder,
  type ModalSubmitFields,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { escapeDiscordMarkdown } from '../../utils';

export const otherModal = async (modal: ModalBuilder) => {
  const oModals = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId('other_subject')
      .setLabel('Subject:')
      .setStyle(TextInputStyle.Short)
      .setRequired(true),
  );
  const oModal = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId('other_input')
      .setLabel('Please describe your issue:')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true),
  );

  return modal.addComponents(oModals, oModal);
};

export const otherMessage = async (fields: ModalSubmitFields) => {
  const header = `# ${escapeDiscordMarkdown(fields.getTextInputValue('other_subject'))}\n`;
  const od = `**Description:** ${escapeDiscordMarkdown(fields.getTextInputValue('other_input'))}\n`;
  return header + od;
};
