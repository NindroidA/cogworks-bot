import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/* options for how the user would like to open a ticket */
export const ticketOptions = () => {
    const options = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_18_verify')
            .setLabel('18+ Verify')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ticket_ban_appeal')
            .setLabel('Ban Appeal')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ticket_player_report')
            .setLabel('Player Report')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ticket_bug_report')
            .setLabel('Bug Report')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ticket_other')
            .setLabel('Other')
            .setStyle(ButtonStyle.Primary),
    );

    return options;
};