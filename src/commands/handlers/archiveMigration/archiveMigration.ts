import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import lang from '../../../utils/lang.json';
import { analyzeArchiveChannel, formatArchiveStats } from './analyzer';

export const archiveMigrationHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const tl = lang.archiveMigration.analyzer;
    const subCommand = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel');

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
            const channelId = channel.id;
            //const channelName = channel.name;

            // send initial message
            await interaction.reply({
                content: tl.start + `${channel}\n` + tl.startMsgEnd
            });

            // analyze
            const analization = await analyzeArchiveChannel(client, channelId);

            // format archive stats
            const msg = formatArchiveStats(analization);

            // reply to interaction
            await interaction.followUp({
                content: msg
            });

        } catch (error) {
            await interaction.reply({
                content: tl.error + '\n' + error
            });
        }
    }
};