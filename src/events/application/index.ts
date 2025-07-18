import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/* options for how the user would like to open an application */
export const applicationOptions = () => {
    const options = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('application_set_builder')
            .setLabel('Set Builder')
            .setStyle(ButtonStyle.Primary)
    );

    return options;
};