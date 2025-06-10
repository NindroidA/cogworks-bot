/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client, Collection, TextChannel } from 'discord.js';
import { lang } from '../../../utils';
const tl = lang.archiveMigration.analyzer;

interface ArchiveStats {
    txtFileCount: number;
    totalSizeBytes: number;
    totalSizeMB: number;
    msgCount: number;
    oldestMsg?: Date;
    newestMsg?: Date;
}

/**
 * analyzeArchiveChannel
 * function to get specific data from an old archive channel containing a bunch of txt transcript files
 * 
 * @param client discord client instance
 * @param channelId id of the text channel to analyze
 * @returns promise with archive stats
 */
export async function analyzeArchiveChannel(client: Client, channelId: string): Promise<ArchiveStats> {
    try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (!channel) throw new Error(lang.general.channelNotFound);

        console.log(tl.start + `#${channel.name}`);

        // variable inits
        let txtFileCount = 0;
        let totalSizeBytes = 0;
        let msgCount = 0;
        let oldestMsg: Date | undefined;
        let newestMsg: Date | undefined;

        // fetch messages in batches
        let lastMsgId: string | undefined;
        let hasMoreMsgs = true;

        while (hasMoreMsgs) {
            const options: any = { limit: 100 };
            if (lastMsgId) {
                options.before = lastMsgId;
            }

            const fetchResult = await channel.messages.fetch(options);
            const messages = fetchResult instanceof Collection ? fetchResult : new Collection().set(fetchResult.id, fetchResult);

            if (messages.size === 0) {
                hasMoreMsgs = false;
                break;
            }

            for (const msg of messages.values()) {
                msgCount++;

                // track oldest and newest messages
                if (!oldestMsg || msg.createdAt < oldestMsg) { oldestMsg = msg.createdAt; }
                if (!newestMsg || msg.createdAt > newestMsg) { newestMsg = msg.createdAt; }

                // check for txt files
                for (const attachment of msg.attachments.values()) {
                    // if txt found, increment the file count and add size to total
                    if (attachment.name?.toLocaleLowerCase().endsWith('.txt')) {
                        txtFileCount++;
                        totalSizeBytes += attachment.size;
                    }
                }
            }

            lastMsgId = messages.last()?.id;

            // progress update every 1000 messages
            if (msgCount % 1000 === 0) {
                console.log(tl.processUpdate + msgCount);
            }
        }

        // figure out the size in terms of MB
        const totalSizeMB = Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100;

        const stats: ArchiveStats = {
            txtFileCount,
            totalSizeBytes,
            totalSizeMB,
            msgCount,
            oldestMsg,
            newestMsg
        };

        // log success and return stats
        console.log(tl.success);
        return stats;
    } catch (error) {
        // log and throw error
        console.error(tl.error, error);
        throw error;
    }
}

/**
 * formatArchiveStats
 * function to format the string for displaying the given archive stats
 * 
 * @param stats archive stats
 * @returns formatted string of results
 */
export function formatArchiveStats(stats: ArchiveStats): string {
    const lStats = tl.formatStats;
    const dateRange = stats.oldestMsg && stats.newestMsg
        ? `${stats.oldestMsg.toDateString()} - ${stats.newestMsg.toDateString()}`
        : tl.unknownDR;

    return lStats.mainHeader +
        lStats.files + ` ${stats.txtFileCount.toLocaleString()} txt files.\n` +
        lStats.storage + ` ${stats.totalSizeMB} MB (${stats.totalSizeBytes.toLocaleString()} bytes).\n` +
        lStats.messages + ` ${stats.msgCount.toLocaleString()}.\n` +
        lStats.dr + ` ${dateRange}.`;
}
