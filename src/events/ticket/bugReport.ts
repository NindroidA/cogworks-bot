import { ActionRowBuilder, ModalBuilder, TextInputStyle, TextInputBuilder, ModalSubmitFields} from "discord.js";

export const bugReportModal = async(modal: ModalBuilder) => {
    const brModalI = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('bug_report_input')
            .setLabel('Bug Report')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
    );

    modal.addComponents(brModalI);
}

export const bugReportMessage = async(fields: ModalSubmitFields) => {
    const header = `# Bug Report\n`;
    const brd = `Report Description: ${fields.getTextInputValue('bug_report_input')}\n`
    return header + brd;
}