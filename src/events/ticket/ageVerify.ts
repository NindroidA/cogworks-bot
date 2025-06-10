import { ActionRowBuilder, ModalBuilder, ModalSubmitFields, TextInputBuilder, TextInputStyle } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.ticket.ageVerify;

export const ageVerifyModal = async(modal: ModalBuilder) => {
    const verifyModal = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('dob_input')
            .setLabel(tl.dobLabel)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
    );

    return modal.addComponents(verifyModal);
};

export const ageVerifyMessage = async(fields: ModalSubmitFields) => {
    const header = tl.header;
    const vdob = tl.dob + fields.getTextInputValue('dob_input');
    return header + vdob;
};