import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { lang } from '../../../utils';
import { DownloadOptions } from '../../../utils/types';
import { analyzeArchiveChannel, formatArchiveStats } from './analyzer';
import { downloadArchiveFiles, formatDownloadStats } from './downloader';
import { formatMigrationStats, migrateTickets } from './migrator';

export const archiveMigrationHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const guild = interaction.guildId;
    const outputDir = `./archiveDownload/${guild}`;

    if (subCommand === 'analyzer') {
        const tl = lang.archiveMigration.analyzer;
        const channel = interaction.options.getChannel('channel');
        await interaction.deferReply();

        // make sure the channel exists
        if (!channel) {
            await interaction.reply({
                content: lang.general.channelNotFound,
                ephemeral: true,
            });
            return;
        }

        try {
            const channelId = channel.id;

            // send initial message
            await interaction.editReply(tl.start + `${channel}\n` + tl.startMsgEnd);

            // analyze
            const analization = await analyzeArchiveChannel(client, channelId);

            // format archive stats
            const msg = formatArchiveStats(analization);

            // follow up with stats
            await interaction.followUp(msg);

        } catch (error) {
            await interaction.followUp(tl.error + '\n' + error);
        }
    } else if (subCommand === 'downloader') {
        const tl = lang.archiveMigration.downloader;
        const channel = interaction.options.getChannel('channel');
        await interaction.deferReply();

        // make sure the channel exists
        if (!channel) {
            await interaction.reply({
                content: lang.general.channelNotFound,
                ephemeral: true,
            });
            return;
        }

        try {  
            const options: DownloadOptions = {
                outputDir,
                skipExisting: true,
                batchSize: 50,
                maxRetries: 3
            };

            // send initial message
            await interaction.editReply(tl.start + `${channel}\n` + tl.startMsgEnd);
                        
            // download
            const stats = await downloadArchiveFiles(interaction.client, channel.id, options);
            
            // format download stats
            const formattedStats = formatDownloadStats(stats);

            // follow up with stats
            await interaction.followUp(formattedStats);
                        
        } catch (error) {
            await interaction.followUp(tl.error + '\n' + error);
        }
    } else if (subCommand === 'migrator') {
        const tl = lang.archiveMigration.migrator;
        await interaction.deferReply();
                    
        try {
            const directory = outputDir;
            const forumChannel = interaction.options.getChannel('forum-channel');
            const dryRun = interaction.options.getBoolean('dry-run');

            if (dryRun === null) {
                throw new Error(tl.dryRunNS);
            }
                
            const forumText = forumChannel ? tl.beforeStart + forumChannel.name : '';
            await interaction.editReply(tl.start + `${directory}${forumText}${dryRun ? ' (DRY RUN)' : ''}...`);
                
            const stats = await migrateTickets(AppDataSource, directory, {
                dryRun,
                filePattern: /\.txt$/,  // only process txt files
                forumChannel,
                client: interaction.client
            });
                
            const formattedStats = formatMigrationStats(stats);
            await interaction.followUp(formattedStats);
                        
        } catch (error) {
            console.error(tl.error, error);
            await interaction.followUp(tl.fail);
        }
    }
};