import { ButtonInteraction, Client, ForumChannel, ForumThreadChannel, GuildTextBasedChannel } from "discord.js";
import { AppDataSource } from "../../typeorm";
import { Ticket } from "../../typeorm/entities/Ticket";
import { ArchivedTicket } from "../../typeorm/entities/ArchivedTicket";
import { ArchivedTicketConfig } from "../../typeorm/entities/ArchivedTicketConfig";
import fs from 'fs';
import dotenv from 'dotenv';
import { fetchMessagesAndSaveToFile } from "../../utils/fetchAllMessages";
dotenv.config();

const ticketRepo = AppDataSource.getRepository(Ticket);
const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);
const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);

export const ticketCloseEvent = async(client: Client, interaction: ButtonInteraction) => {
    const guildId = interaction.guildId || ''; // guild where the event was initiated
    const user = interaction.user; // user who initiated the event
    const channel = interaction.channel as GuildTextBasedChannel; // text channel the event was initiated
    const channelId = interaction.channelId || '';
    const transcriptPath = `src/archivedTickets/`; // path to temporarily save ticket transcripts
    const archivedConfig = await archivedTicketConfigRepo.findOneBy({ guildId }); // get the archived ticket config by guildId
    const ticket = await ticketRepo.findOneBy({ channelId: channelId }); // // get the ticket this event was initiated from the Ticket database using channelId

    // check if the archived ticket config exists
    if (!archivedConfig) { return console.log('Archived Ticket Config does not exist!'); }

    // check if the ticket exists
    if (!ticket) { return console.log('Ticket not Found!') };

    // make sure the ticket close is permitted
    // TODO: add ability for mod role to close it aswell
    if (user.id === ticket.createdBy) {
        console.log('User who created a ticket is now closing the ticket...');

        // update the ticket status
        await ticketRepo.update({ id: ticket.id }, { status: 'closed' });
    }

    // get archived channel from ArchivedTicket database using createdBy
    const createdBy = ticket.createdBy;
    const transcriptChannel = await archivedTicketRepo.findOneBy({ createdBy: createdBy });
    
    // make the transcript file
    try {
        await fetchMessagesAndSaveToFile(channel, transcriptPath);
    } catch (error) {
        console.error('Error making transcript file!', error);
        await interaction.reply({
            content: 'Could not create a transcript!'
        });
        return;
    }

    // send the transcript file
    try {
        const forumId = archivedConfig.channelId; // channelId of the archive forum channel
        const forumChannel = await client.channels.fetch(forumId) as ForumChannel; // the actual archive forum channel
        const txtPath = transcriptPath + `${channelId}.txt`;
        const zipPath = transcriptPath + `attachments_${channelId}.zip`;
        let zipCheck: boolean = false; // flag check to see if we have a zip file for attachments
        const files = [txtPath];

        // if we have attachments, add them to the files array
        if (fs.existsSync(zipPath)) {
            files.push(zipPath);
            console.log('Attachment file found; adding to message.');
            zipCheck = true;
        } else {
            console.log('Attachments not found; continuing ...');
        }

        // if transcript channel doesn't exist, make one and put the transcript
        if (!transcriptChannel) {
            const archiveUser = client.users.fetch(createdBy); // the user to archive (user who created the original ticket)

            // make the new thread with the transcript
            const newPost = await forumChannel.threads.create({
                name: (await archiveUser).username,
                message: {
                    files: files
                }
            });

            // create archived ticket in database
            const newArchivedTicket = archivedTicketRepo.create({
                createdBy: ticket.createdBy,
                messageId: newPost.id, 
            });

            //save to database
            await archivedTicketRepo.save(newArchivedTicket);
        // if transcript channel DOES exist, just add the transcript to the channel
        } else {
            const existMsg = transcriptChannel.messageId; // existing message in the thread
            const post = await forumChannel.threads.fetch(existMsg) as ForumThreadChannel; // existing thread
            await post.send({ files: files });

        }

        // delete the saved txt file
        fs.unlink(txtPath, (error) => {
            if (error) console.error('Error deleting transcript txt file!', error);
        });

        if (zipCheck) {
            // delete the saved zip file
            fs.unlink(zipPath, (error) => {
                if (error) console.error('Error deleting transcript attachments zip file!', error);
            });
        }

    } catch (error) {
        return console.error('Could not properly send transcript!', error);
    }

    // log success message
    console.log('Transcript successfully sent to channel and deleted from memory!');

    // delete the channel
    await channel.delete(ticket.channelId);
}