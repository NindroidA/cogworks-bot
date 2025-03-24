/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interaction, ActionRowBuilder, GuildMember, TextChannel, Client, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, GuildTextBasedChannel, ForumChannel, ForumThreadChannel } from "discord.js";
import { AppDataSource } from "../typeorm";
import { TicketConfig } from "../typeorm/entities/TicketConfig";
import dotenv from 'dotenv';
import { Ticket } from "../typeorm/entities/Ticket";
import { ArchivedTicket } from "../typeorm/entities/ArchivedTicket";
import fs from 'fs';
import { fetchMessagesAndSaveToFile } from "../utils/fetchAllMessages";
import { ArchivedTicketConfig } from "../typeorm/entities/ArchivedTicketConfig";

dotenv.config();

const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
const ticketRepo = AppDataSource.getRepository(Ticket);
const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);
const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);

export const handleTicketInteraction = async(client: Client, interaction: Interaction) => {

    const guildId = interaction.guildId || '';

    // handle button presses
    if (interaction.isButton() && interaction.customId === 'create_ticket'){
        const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

        // check if the ticket config exists
        if (!ticketConfig) {
            console.log('Ticket config does not exsit!');
            return;
        }

        // check if we have the right messageid
        if (ticketConfig.messageId === interaction.message.id) {
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
                /*new ButtonBuilder()
                    .setCustomId('cancel_ticket')
                    .setLabel('Cancel Ticket')
                    .setStyle(ButtonStyle.Primary),*/
            );
        
            await interaction.reply({
                content: 'Please select the type of ticket you want to create:',
                components: [options],
                ephemeral: true,
            });
        }
    }

    /* Cancel Ticket Button */
    if (interaction.isButton() && interaction.customId === 'cancel_ticket') {
        await interaction.reply({
            content: 'Ticket creation cancelled.',
            ephemeral: true
        });
    }

    /* Ticket Option Buttons */
    if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
        const ticketType = interaction.customId.replace('ticket_', '');

        // build a modal for user input
        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${ticketType}`)
            .setTitle(`Create ${ticketType.replace('_', ' ')} Ticket`);

        // add inputs to modal based on ticketType
        switch (ticketType) {
            case '18_verify':
                const verifyModal = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('dob_input')
                        .setLabel('Please provide your dob (mm/dd/yyyy)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                );

                modal.addComponents(verifyModal);
                break;

            case 'ban_appeal':
                const baModalIGN = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_ign_input')
                        .setLabel('Your Minecraft In-Game-Name:')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                );
                const baModalRFB = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_rfb_input')
                        .setLabel('Reason for ban:')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                );
                const baModalDOB = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_dob_input')
                        .setLabel('Date of ban:')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                );
                const baModalS = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_staff_input')
                        .setLabel('Staff who banned you:')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                );
                const baModalR = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('appeal_reason_input')
                        .setLabel('Why you think you should be unbanned:')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                );

                modal.addComponents(baModalIGN, baModalRFB, baModalDOB, baModalS, baModalR);
                break;

            case 'player_report':
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
                break;

            case 'bug_report':
                const brModalI = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('bug_report_input')
                        .setLabel('Bug Report')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true),
                );

                modal.addComponents(brModalI);
                break;
            case 'other':
                const oModals = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('other_subject')
                        .setLabel('Subject:')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true),
                );
                const oModal = new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('other_input')
                        .setLabel('Please describe your issue:')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true),
                );

                modal.addComponents(oModals, oModal);
                break;
        }

        await interaction.showModal(modal)
    }

    // handle modal submission
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
        const ticketType = interaction.customId.replace('ticket_modal_', '');
        const member = interaction.member as GuildMember;
        const guild = interaction.guild;

        if (!guild) {
            await interaction.reply({
                content: 'This command can only be used in a server!',
                ephemeral: true,
            });

            return;
        }

        // get user input from modal
        const fields = interaction.fields;
        let description = '';
        let header = '';

        switch (ticketType) {
            case '18_verify':
                header = `# 18+ Verify\n`;
                const vdob = `Date of Birth: ${fields.getTextInputValue('dob_input')}`;
                description = header + vdob;
                break;
      
            case 'ban_appeal':
                header = `# Ban Appeal\n`;
                const ign = `In Game Name: ${fields.getTextInputValue('appeal_ign_input')}\n`;
                const rfb = `Reason for Ban: ${fields.getTextInputValue('appeal_rfb_input')}\n`;
                const dob = `Date of Ban: ${fields.getTextInputValue('appeal_dob_input')}\n`;
                const s = `Staff who banned you: ${fields.getTextInputValue('appeal_staff_input')}\n\n`;
                const r = `Why you think you should be unbanned: ${fields.getTextInputValue('appeal_reason_input')}\n`;
                description = header + ign + rfb + dob + s + r;
                break;
      
            case 'player_report':
                header = `# Player Report\n`;
                const prn = `Name to Report: ${fields.getTextInputValue('player_report_ign')}\n`;
                const prd = `Report Description: ${fields.getTextInputValue('player_report_descrp')}\n`;
                description = header + prn + prd;
                break;

            case 'bug_report':
                header = `# Bug Report\n`;
                const brd = `Report Description: ${fields.getTextInputValue('bug_report_input')}\n`
                description = header + brd;
                break;
      
            case 'other':
                header = `# ${fields.getTextInputValue('other_subject')}\n`
                const od = `Description: ${fields.getTextInputValue('other_input')}\n`
                description = header + od;
                break;
        }

        // create new ticket in the database
        const newTicket = ticketRepo.create({
            createdBy: interaction.user.id,
            type: ticketType,
        });
        const savedTicket = await ticketRepo.save(newTicket);

        // create the ticket channel
        const CATEGORY = process.env.TICKET_CATEGORY_ID!;
        const channelName = `${savedTicket.id}-${ticketType}-${member.user.username}`;
        const channel = await guild.channels.create({
            name: channelName,
            type: 0, // text channel
            parent: CATEGORY, // category
            permissionOverwrites: [
                { id: guild.id, deny: ['ViewChannel'] }, // deny everyone
                { id: member.id, allow: ['ViewChannel', 'SendMessages'] }, // allow ticket creator
                //{ id: process.env.MOD_ROLE_ID!, allow: ['ViewChannel', 'SendMessages'] }, // allow moderators
            ],
        });

        await interaction.reply({
            content: `Your ticket has been created: ${channel}`,
            ephemeral: true,
        });

        // send ticket welcome message
        //const welcomeMsg = `Welcome, ${member.user.displayName}!\n\n**Ticket Type:**${ticketType.replace('_',' ')}\n\n${description}`;
        const welcomeMsg = `Welcome, ${member.user.displayName}! Please wait for a staff member to assist you. Once the issue is resolved, you or a staff member can close the ticket with the button below.`;
        const closeButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
        );
        const descriptionMsg = `${description}`;
        const newChannel = channel as TextChannel;

        const welc = await newChannel.send({
            content: welcomeMsg,
            components: [closeButton],
        })
        await newChannel.send(descriptionMsg);

        ticketRepo.update({ id: savedTicket.id }, {
            messageId: welc.id,
            channelId: newChannel.id,
            status: 'opened',
        });
    }
    
    /* CLOSING A TICKET */
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        const user = interaction.user;
        const member = interaction.member as GuildMember;
        const guild = interaction.guild;
        const channel = interaction.channel as GuildTextBasedChannel;
        const transcriptPath = `src/archivedTickets/${interaction.channelId}.txt`;
        const archivedConfig = await archivedTicketConfigRepo.findOneBy({ guildId });

        if (!guild) {
            await interaction.reply({
                content: 'This command can only be used in a server!',
                ephemeral: true,
            });

            return;
        }

        // check if the archived ticket config exists
        if (!archivedConfig) {
            console.log('Archived Ticket Config does not exsit!');
            return;
        }

        // get the ticket from Ticket database using channelId
        const ticket = await ticketRepo.findOneBy({ channelId: interaction.channelId });

        // check for ticket
        if (!ticket) { return console.log('Ticket not Found!'); }

        // make sure the ticket close is permitted
        // TODO: add ability for mods to close it aswell
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
            // if transcript channel doesn't exist, make one and put the transcript
            if (!transcriptChannel) {
                // create new transcript forum
                const acId = archivedConfig.channelId;
                const archiveChannel = await client.channels.fetch(acId) as ForumChannel;
                const archiveUser = client.users.fetch(createdBy);
                const newPost = await archiveChannel.threads.create({
                    name: (await archiveUser).username,
                    message: {
                        files: [transcriptPath]
                    }
                });
                
                // create archived ticket in database
                const newTranscript = archivedTicketRepo.create({
                    createdBy: ticket.createdBy,
                    messageId: newPost.id,
                });

                // save to database
                await archivedTicketRepo.save(newTranscript);

            // if transcript channel DOES exist, just add the transcript to the channel
            } else {
                const acId = archivedConfig.channelId;
                const existMsg = transcriptChannel.messageId; 
                const archiveChannel = await client.channels.fetch(acId) as ForumChannel;
                const post = await archiveChannel.threads.fetch(existMsg) as ForumThreadChannel;
                await post.send({ files: [transcriptPath] });
                
            }

            // delete the txt file
            fs.unlink(transcriptPath, (error) => {
                if (error) console.error('Error deleting transcript txt file!:', error);
            });

        } catch (error) {
            console.error('Could not properly send transcript!:', error);
            return;
        }

        // log success message
        console.log('Transcript successfully sent to channel and deleted from memory!');

        // delete the channel
        await guild.channels.delete(ticket.channelId);
    }
}