import { ActionRowBuilder, ModalBuilder, TextInputStyle, TextInputBuilder, ModalSubmitFields} from "discord.js";

export const ageVerifyModal = async(modal: ModalBuilder) => {
    const verifyModal = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('dob_input')
            .setLabel('Please provide your dob (mm/dd/yyyy)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
    );

    return modal.addComponents(verifyModal);
}

export const ageVerifyMessage = async(fields: ModalSubmitFields) => {
    const header = `# 18+ Verify\n`;
    const vdob = `Date of Birth: ${fields.getTextInputValue('dob_input')}`;
    return header + vdob;
}