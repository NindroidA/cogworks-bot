import {
  ActionRowBuilder,
  type ModalBuilder,
  type ModalSubmitFields,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { escapeDiscordMarkdown } from '../../utils';

export const playerReportModal = async (modal: ModalBuilder) => {
  const prModalN = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId('player_report_ign')
      .setLabel('Name to Report')
      .setStyle(TextInputStyle.Short)
      .setRequired(true),
  );
  const prModalR = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId('player_report_descrp')
      .setLabel('Report Description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true),
  );

  return modal.addComponents(prModalN, prModalR);
};

// Staff ping is now handled centrally in ticketInteraction.ts via /ticket settings ping-on-create
export const playerReportMessage = async (fields: ModalSubmitFields) => {
  const header = '# Player Report\n';
  const prn = `**Name to Report:** ${escapeDiscordMarkdown(fields.getTextInputValue('player_report_ign'))}\n`;
  const prd = `**Report Description:** ${escapeDiscordMarkdown(fields.getTextInputValue('player_report_descrp'))}\n`;

  return header + prn + prd;
};
