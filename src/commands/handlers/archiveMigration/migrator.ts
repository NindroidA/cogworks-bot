/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs/promises';
import * as path from 'path';
import { DataSource, Repository } from 'typeorm';
import { ArchivedTicket } from '../../../typeorm/entities/ArchivedTicket';
import { lang } from '../../../utils';

interface ParsedTicket {
    ticketNumber: number;
    ticketName: string;
    createdBy: string;
    createdAt: Date;
    closedAt: Date;
    filename: string;
}

interface MigrationStats {
    totalFiles: number;
    successfullyParsed: number;
    successfullyMigrated: number;
    skipped: number;
    errors: string[];
    duplicates: number;
}

const tl = lang.archiveMigration.migrator;

/**
 * parseTicketHeader
 * function to parse a ticket transcript file header to extract ticket information
 * 
 * @param fileContent content of the txt file
 * @param filename filename for error reporting
 * @returns parsed ticket data (or null if parsing fails)
 */
function parseTicketHeader(fileContent: string, filename: string): ParsedTicket | null {
    try {
        const lines = fileContent.split('\n');
        const headerLine = lines[0];
        
        // regex to parse: "Transcript of ticket <#> - <display name>, opened by <username> at <date>, closed at <date>."
        const headerRegex = /^Transcript of ticket #(\d+) - (.+?), opened by (.+?) at (.+?), closed at (.+?)\.$/;
        const match = headerLine.match(headerRegex);
        
        if (!match) {
            console.warn(tl.run.failParse + ` ${filename}: "${headerLine}"`);
            return null;
        }
        
        const [, ticketNumberStr, ticketName, createdBy, createdAtStr, closedAtStr] = match;
        
        // parse dates
        const createdAt = new Date(createdAtStr);
        const closedAt = new Date(closedAtStr);
        
        if (isNaN(createdAt.getTime()) || isNaN(closedAt.getTime())) {
            console.warn(tl.run.warnDate + filename);
            return null;
        }
        
        return {
            ticketNumber: parseInt(ticketNumberStr),
            ticketName: ticketName.trim(),
            createdBy: createdBy.trim(),
            createdAt,
            closedAt,
            filename
        };
        
    } catch (error) {
        console.error(tl.run.failParse + filename, error);
        return null;
    }
}

/**
 * migrateTickets
 * function to actually migrate ticket files to the database and creates forum posts
 * 
 * @param dataSource typeORM DataSource instance
 * @param ticketsDirectory directory containing the txt files
 * @param options migration options
 * @returns migration statistics
 */
export async function migrateTickets(dataSource: DataSource, ticketsDirectory: string,
    options: {
        dryRun?: boolean;
        filePattern?: RegExp;
        forumChannel?: any;
        client?: any;
    } = {}
): Promise<MigrationStats> {
    const stats: MigrationStats = {
        totalFiles: 0,
        successfullyParsed: 0,
        successfullyMigrated: 0,
        skipped: 0,
        errors: [],
        duplicates: 0
    };
    
    try {
        console.log(tl.start + ticketsDirectory);
        
        if (options.dryRun) {
            console.log(tl.dryRun.enabled);
        }
        
        // get typeORM repo
        const ticketRepo: Repository<ArchivedTicket> = dataSource.getRepository(ArchivedTicket);
        
        // validate forum posting requirements
        const shouldCreateForumPosts = options.forumChannel && options.client;
        if (shouldCreateForumPosts && options.dryRun) {
            console.log(tl.dryRun.posting);
        } else if (shouldCreateForumPosts) {
            console.log(tl.run.posting + options.forumChannel.name);
        }
        
        // read all files in directory
        const files = await fs.readdir(ticketsDirectory);
        const txtFiles = files.filter(file => {
            const matchesPattern = options.filePattern ? options.filePattern.test(file) : file.endsWith('.txt');
            return matchesPattern && file !== 'archive_metadata.json';
        });
        
        stats.totalFiles = txtFiles.length;
        console.log(tl.run.filesFound + stats.totalFiles);
        
        // process each file
        for (const filename of txtFiles) {
            try {
                const filePath = path.join(ticketsDirectory, filename);
                const fileContent = await fs.readFile(filePath, 'utf-8');
                
                const parsedTicket = parseTicketHeader(fileContent, filename);
                
                if (!parsedTicket) {
                    stats.errors.push(tl.run.failParse + filename);
                    continue;
                }
                
                stats.successfullyParsed++;
                console.log(tl.run.processTicket + ` #${parsedTicket.ticketNumber} by ${parsedTicket.createdBy}`);
                
                // continue with changes if dryRun is false
                if (!options.dryRun) {
                    let postId: string = '';
                    
                    // create forum post if forum channel is provided
                    if (shouldCreateForumPosts) {
                        try {
                            // check if archived ticket already exists for this user
                            const existingTicket = await ticketRepo.findOneBy({ createdBy: parsedTicket.createdBy });
                            
                            if (existingTicket && existingTicket.messageId) {
                                // existing forum post found - add file to existing thread
                                console.log(tl.run.alrExists + parsedTicket.createdBy);
                                const existingPost = await options.forumChannel.threads.fetch(existingTicket.messageId);
                                
                                if (existingPost) {
                                    await existingPost.send({
                                        files: [{
                                            attachment: filePath,
                                            name: `ticket_${parsedTicket.ticketNumber}_${parsedTicket.ticketName}.txt`
                                        }]
                                    });
                                    postId = existingTicket.messageId; // keep the same messageId
                                    console.log(tl.run.existingPost + ` ${parsedTicket.createdBy} (${existingPost.id})`);
                                    stats.duplicates++;
                                } else {
                                    throw new Error(tl.run.failForumFetch);
                                }
                            } else {
                                // no existing forum post - create new one
                                const archiveUser = await options.client.users.fetch(parsedTicket.createdBy).catch(() => null);
                                const displayName = archiveUser ? archiveUser.username : parsedTicket.createdBy;
                                
                                // create the forum post with the txt file
                                const newPost = await options.forumChannel.threads.create({
                                    name: displayName,
                                    message: {
                                        files: [{
                                            attachment: filePath,
                                            name: `ticket_${parsedTicket.ticketNumber}_${parsedTicket.ticketName}.txt`
                                        }]
                                    }
                                });
                                
                                postId = newPost.id;
                                console.log(tl.run.creatingPost + ` ${displayName} (${newPost.id})`);
                            }
                        } catch (error) {
                            console.error(tl.run.failPost + parsedTicket.createdBy, error);
                            stats.errors.push(tl.run.failPost + parsedTicket.createdBy + ': ' + error);
                        }
                    }
                    
                    // create or update archived ticket in database
                    const existingTicket = await ticketRepo.findOneBy({ createdBy: parsedTicket.createdBy });
                    
                    if (existingTicket) {
                        // update existing ticket if messageId is empty or if we created a new post
                        if (!existingTicket.messageId && postId) {
                            existingTicket.messageId = postId;
                            await ticketRepo.save(existingTicket);
                            console.log(tl.run.updateDB + parsedTicket.createdBy);
                        }
                    } else {
                        // create new archived ticket
                        const archivedTicket = new ArchivedTicket();
                        archivedTicket.createdBy = parsedTicket.createdBy;
                        archivedTicket.messageId = postId;
                        
                        await ticketRepo.save(archivedTicket);
                        console.log(tl.run.newDB + parsedTicket.createdBy);
                    }
                } else {
                    // if dry run is true, just log what would happen
                    if (shouldCreateForumPosts) {
                        const existingTicket = await ticketRepo.findOneBy({ createdBy: parsedTicket.createdBy });
                        if (existingTicket && existingTicket.messageId) {
                            console.log(tl.dryRun.existingPost + parsedTicket.createdBy);
                            stats.duplicates++;
                        } else {
                            console.log(tl.dryRun.creatingPost + parsedTicket.createdBy);
                        }
                    }
                    console.log(tl.dryRun.updateDB + parsedTicket.createdBy);
                }
                
                stats.successfullyMigrated++;
                
            } catch (error) {
                const errorMsg = tl.run.failProcessing + filename + ': ' + error;
                console.error(errorMsg);
                stats.errors.push(errorMsg);
            }
        }
        
        console.log(tl.success);
        return stats;
        
    } catch (error) {
        console.error(tl.fatalErr + error);
        stats.errors.push(tl.fatalErr + error);
        throw error;
    }
}

/**
 * formatMigrationStats
 * function to format the string for displaying the given migration stats
 * 
 * @param stats migration stats
 * @returns formatted string of results
 */
export function formatMigrationStats(stats: MigrationStats): string {
    const lStats = tl.formatStats;
    let result = lStats.mainHeader +
        lStats.totalFiles + ` ${stats.totalFiles}\n` +
        lStats.parseSuccess + ` ${stats.successfullyParsed}\n` +
        lStats.migrateSuccess + ` ${stats.successfullyMigrated}\n` +
        lStats.migrateSkipped + ` ${stats.skipped}\n` +
        lStats.migrateDupes + ` ${stats.duplicates}\n`;

    if (stats.errors.length > 0) {
        result += `\n\n**Errors (${stats.errors.length}):**\n`;
        result += stats.errors.slice(0, 3).map(err => `- ${err}`).join('\n');
        if (stats.errors.length > 3) {
            result += `\n- ... and ${stats.errors.length - 3} more errors`;
        }
    }
    
    return result;
}