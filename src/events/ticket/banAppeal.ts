import { ActionRowBuilder, ModalBuilder, ModalSubmitFields, TextInputBuilder, TextInputStyle } from 'discord.js';

export const banAppealModal = async(modal: ModalBuilder) => {
    const modalIGN = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('appeal_ign_input')
            .setLabel('Minecraft IGN:')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Your Minecraft In-Game-Name')
            .setRequired(true)
    );
    const modalRFB = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('appeal_rfb_input')
            .setLabel('Reason for ban:')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
    );
    const modalDOB = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('appeal_dob_input')
            .setLabel('Date of ban:')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('dd/mm/yyyy')
            .setRequired(true)
    );
    const modalS = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('appeal_staff_input')
            .setLabel('Staff who banned you:')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
    );
    const modalR = new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
            .setCustomId('appeal_reason_input')
            .setLabel('Why you think you should be unbanned:')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
    );

    return modal.addComponents(modalIGN, modalRFB, modalDOB, modalS, modalR);
};

export const banAppealMessage = async(fields: ModalSubmitFields) => {
    const header = '# Ban Appeal\n';
    const ign = `**In Game Name:** ${fields.getTextInputValue('appeal_ign_input')}\n`;
    const rfb = `**Reason for Ban:** ${fields.getTextInputValue('appeal_rfb_input')}\n`;
    const dob = `**Date of Ban:** ${fields.getTextInputValue('appeal_dob_input')}\n`;
    const s = `**Staff who banned you:** ${fields.getTextInputValue('appeal_staff_input')}\n`;
    const r = `**Why you think you should be unbanned:** ${fields.getTextInputValue('appeal_reason_input')}\n`;
    return header + ign + rfb + dob + s + r;
};