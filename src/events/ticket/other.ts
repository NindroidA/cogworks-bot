import { ActionRowBuilder, ModalBuilder, TextInputStyle, TextInputBuilder, ModalSubmitFields} from "discord.js";

export const otherModal = async(modal: ModalBuilder) => {
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
    
    modal.addComponents(oModals, oModal);
}

export const otherMessage = async(fields: ModalSubmitFields) => {
    const header = `# ${fields.getTextInputValue('other_subject')}\n`
    const od = `Description: ${fields.getTextInputValue('other_input')}\n`
    return header + od;
}