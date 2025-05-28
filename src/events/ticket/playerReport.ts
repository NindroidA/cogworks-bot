import { ActionRowBuilder, Interaction, ModalBuilder, ModalSubmitFields, TextInputBuilder, TextInputStyle } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import lang from '../../utils/lang.json';

export const playerReportModal = async(modal: ModalBuilder) => {
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

    modal.addComponents(prModalN, prModalR);
};

export const playerReportMessage = async(fields: ModalSubmitFields, interaction: Interaction) => {
    const guildId = interaction.guildId;
    const header = '# Player Report\n';
    const prn = `Name to Report: ${fields.getTextInputValue('player_report_ign')}\n`;
    const prd = `Report Description: ${fields.getTextInputValue('player_report_descrp')}\n`;

    // if guild is not found, throw an error
    if (!guildId) { throw Error; }

    // get the bot config repo
    const botConfigRepo = AppDataSource.getRepository(BotConfig);
    const botConfig = await botConfigRepo.findOneBy({ guildId });
    const gsrFlag = botConfig?.enableGlobalStaffRole;
    const gsr = botConfig?.globalStaffRole + '\n';

    // if the bot config isn't setup
    if (!botConfig || !gsr) {
        console.log(lang.botConfig.notFound);
    // if the global staff role is enabled but isn't set
    } else if (gsrFlag && !gsr) {
        console.log(lang.botConfig.noStaffRole);
    // if the global staff role is enabled and set, add the mention to the message
    } else if (gsrFlag && gsr) {
        return header + gsr + prn + prd;
    } 

    return header + prn + prd;
};