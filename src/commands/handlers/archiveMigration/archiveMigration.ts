import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import lang from '../../../utils/lang.json';
import { analyzeArchiveChannel, formatArchiveStats } from './analyzer';

export const archiveMigrationHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel')?.id;

    // make sure the channel exists
    if (!channel) {
        await interaction.reply({
            content: lang.general.channelNotFound,
            ephemeral: true,
        });
        return;
    }

    if (subCommand == 'analyzer') {
        try {
            // analyze
            const analization = await analyzeArchiveChannel(client, channel);

            // format archive stats
            const msg = formatArchiveStats(analization);

            // reply to interaction
            interaction.reply({
                content: msg
            });

        } catch (error) {
            interaction.reply({
                content: lang.archiveMigration.analyzer.error + '\n' + error
            });
        }
    }
};