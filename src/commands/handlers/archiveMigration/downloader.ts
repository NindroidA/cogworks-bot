/* eslint-disable @typescript-eslint/no-explicit-any */
import { Attachment, Client, Collection, Message, TextChannel } from 'discord.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { formatBytes } from '../../../utils';
import lang from '../../../utils/lang.json';
import { DownloadOptions } from '../../../utils/types';

const tl = lang.archiveMigration.downloader;

interface DownloadStats {
    totalFiles: number;
    downloadedFiles: number;
    skippedFiles: number;
    failedFiles: number;
    totalSizeBytes: number;
    startTime: Date;
    endTime?: Date;
    errors: string[];
}

interface FileMetadata {
    originalFilename: string;
    messageId: string;
    messageUrl: string;
    author: string;
    timestamp: string;
    fileSize: number;
}

/**
 * downloadArchiveFiles
 * downloads all txt files from the given archive channel
 * 
 * @param client discord client instance
 * @param channelId id of the archive channel
 * @param options download configuration options
 * @returns promise with download statistics
 */
export async function downloadArchiveFiles(client: Client, channelId: string, options: DownloadOptions): Promise<DownloadStats> {
    const stats: DownloadStats = {
        totalFiles: 0,
        downloadedFiles: 0,
        skippedFiles: 0,
        failedFiles: 0,
        totalSizeBytes: 0,
        startTime: new Date(),
        errors: []
    };

    try {
        const metaFile = 'archive_metadata.json';
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (!channel) throw new Error(lang.general.channelNotFound);

        console.log(tl.start + `#${channel.name}`);

        // create output directory
        console.log(tl.outDir + options.outputDir);
        await fs.mkdir(options.outputDir, { recursive: true });
        
        // create metadata file
        console.log(tl.createMD + metaFile);
        const metadataPath = path.join(options.outputDir, metaFile);
        const allMetadata: FileMetadata[] = [];
        
        // variable inits
        let processedMsgs = 0;
        let lastMsgId: string | undefined;
        let hasMoreMsgs = true;
        
        while (hasMoreMsgs) {
            const fetchOptions: any = { limit: options.batchSize || 100 };
            if (lastMsgId) {
                fetchOptions.before = lastMsgId;
            }
            
            const fetchResult = await channel.messages.fetch(fetchOptions);
            const messages = fetchResult instanceof Collection ? fetchResult : new Collection().set(fetchResult.id, fetchResult);
            
            if (messages.size === 0) {
                hasMoreMsgs = false;
                break;
            }
            
            for (const message of messages.values()) {
                processedMsgs++;
                
                for (const attachment of message.attachments.values()) {
                    if (attachment.name?.toLowerCase().endsWith('.txt')) {
                        stats.totalFiles++;
                        
                        const success = await downloadFile(attachment, message, options, stats, allMetadata);
                        
                        if (success) {
                            stats.downloadedFiles++;
                            stats.totalSizeBytes += attachment.size;
                        }
                    }
                }
                
                // progress update
                if (processedMsgs % 500 === 0) {
                    console.log(tl.processUpdate + processedMsgs);
                    console.log(tl.downloadUpdate + (stats.downloadedFiles / stats.totalFiles));
                }
            }
            
            lastMsgId = messages.last()?.id;
            
            // small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // save metadata
        await fs.writeFile(metadataPath, JSON.stringify(allMetadata, null, 2));
        console.log(tl.savedMetadata + allMetadata.length);
        
        // update end time, log success, and return download stats
        stats.endTime = new Date();
        console.log(tl.success);
        return stats;
        
    } catch (error) {
        console.error(tl.error, error);
        stats.errors.push(`${error}`);
        throw error;
    }
}

/**
 * downloadFile
 * downloads a single file with retry logic
 * 
 * @param attachment txt attachment
 * @param message discord message
 * @param options download options
 * @param stats download stats
 * @param allMetadata file metadata
 * @returns 
 */
async function downloadFile(attachment: Attachment, message: Message, options: DownloadOptions, stats: DownloadStats, allMetadata: FileMetadata[]): Promise<boolean> {
    const maxRetries = options.maxRetries || 3;
    
    //generate safe filename
    const timestamp = message.createdAt.toISOString().slice(0, 19).replace(/:/g, '-');
    const safeFilename = `${timestamp}_${message.id}_${sanitizeFilename(attachment.name || 'unknown.txt')}`;
    const filePath = path.join(options.outputDir, safeFilename);
    
    // check if file already exists
    if (options.skipExisting) {
        try {
            await fs.access(filePath);
            console.log(tl.skipExisting + safeFilename);
            stats.skippedFiles++;
            return true;
        } catch {
            // file doesn't exist, continue with download
        }
    }
    
    // store metadata
    allMetadata.push({
        originalFilename: attachment.name || 'unknown.txt',
        messageId: message.id,
        messageUrl: message.url,
        author: `${message.author.username}`,
        timestamp: message.createdAt.toISOString(),
        fileSize: attachment.size
    });

    
    // download with retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(tl.downloading + `${safeFilename} (${formatBytes(attachment.size)})`);
            
            const response = await fetch(attachment.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await fs.writeFile(filePath, buffer);
            
            return true;
            
        } catch (error) {
            console.error(tl.attemptFail + `${safeFilename} (${attempt}/${maxRetries})`);
            
            if (attempt === maxRetries) {
                stats.failedFiles++;
                stats.errors.push(`${error}`);
                return false;
            }
            
            // wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    
    return false;
}

/**
 * sanitizeFilename
 * helper function to sanitize file name for file system compatibility
 * 
 * @param filename 
 * @returns string of the sanitized file name
 */
function sanitizeFilename(filename: string): string {
    return filename.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
}

/**
 * formatDownloadStats
 * function to format the string for displaying the given download stats
 * 
 * @param stats download stats
 * @returns formatted string of results
 */
export function formatDownloadStats(stats: DownloadStats): string {
    const lStats = tl.formatStats;

    const duration = stats.endTime 
        ? Math.round((stats.endTime.getTime() - stats.startTime.getTime()) / 1000)
        : 0;    

    let result = lStats.mainHeader + 
        lStats.totalFiles + ` ${stats.totalFiles}\n` +
        lStats.downloadSuccess + ` ${stats.downloadedFiles}\n` +
        lStats.downloadSkipped + ` ${stats.skippedFiles}\n` +
        lStats.downloadFailed + ` ${stats.failedFiles}\n` +
        lStats.downloadTotal + ` ${formatBytes(stats.totalSizeBytes)}\n` +
        lStats.duration + ` ${duration} seconds`; 

    if (stats.errors.length > 0) {
        result += `\n\n**Errors (${stats.errors.length}):**\n`;
        result += stats.errors.slice(0, 5).map(err => `- ${err}`).join('\n');
        if (stats.errors.length > 5) {
            result += `\n- ... and ${stats.errors.length - 5} more errors`;
        }
    }
    
    return result;
}