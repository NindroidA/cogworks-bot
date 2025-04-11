import { Interaction, ActionRowBuilder, GuildMember, TextChannel, Client, ButtonBuilder, ButtonStyle, ModalBuilder, PermissionFlagsBits } from "discord.js";
import { AppDataSource } from "../typeorm";
import { TicketConfig } from "../typeorm/entities/TicketConfig";
import dotenv from 'dotenv';
import { Ticket } from "../typeorm/entities/Ticket";
import { ticketCloseEvent } from "./ticket/close";
import { ageVerifyMessage, ageVerifyModal } from "./ticket/ageVerify";
import { banAppealMessage, banAppealModal } from "./ticket/banAppeal";
import { playerReportMessage, playerReportModal } from "./ticket/playerReport";
import { bugReportMessage, bugReportModal } from "./ticket/bugReport";
import { otherMessage, otherModal } from "./ticket/other";
import { ticketOptions } from "./ticket";
import { SavedRole } from "../typeorm/entities/SavedRole";

dotenv.config();

const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
const ticketRepo = AppDataSource.getRepository(Ticket);
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

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
            const options = ticketOptions();
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
                await ageVerifyModal(modal);
                break;
            case 'ban_appeal':
                await banAppealModal(modal);
                break;
            case 'player_report':
                await playerReportModal(modal);
                break;
            case 'bug_report':
                await bugReportModal(modal);
                break;
            case 'other':
                await otherModal(modal);
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

        try {
            // get user input from modal
            const fields = interaction.fields;
            let description = '';

            switch (ticketType) {
                case '18_verify':
                    description = await ageVerifyMessage(fields);
                    break;
                case 'ban_appeal':
                    description = await banAppealMessage(fields);
                    break;
                case 'player_report':
                    description = await playerReportMessage(fields);
                    break;
                case 'bug_report':
                    description = await bugReportMessage(fields);
                    break;
                case 'other':
                    description = await otherMessage(fields);
                    break;
            }

            // create new ticket in the database
            const newTicket = ticketRepo.create({
                createdBy: interaction.user.id,
                type: ticketType,
            });
            const savedTicket = await ticketRepo.save(newTicket);

            // helper function to extract ID from mention
            function extractIdFromMention(mention: string): string | null {
                const matches = mention.match(/^<@&?(\d+)>$/);
                return matches ? matches[1] : null;
            }

            // create the ticket channel
            const CATEGORY = process.env.TICKET_CATEGORY_ID!;
            const channelName = `${savedTicket.id}-${ticketType}-${member.user.username}`;

            // get the staff/admin roles from the database
            const rolePerms = await savedRoleRepo.createQueryBuilder()
                .select(['type', 'role'])
                .where('guildId = :guildId', { guildId: guildId })
                .getRawMany();

            // base perms
            const permOverwrites = [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // deny everyone
                { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, // allow ticket creator
            ];

            // add permissions for each staff/admin role
            rolePerms.forEach(role => {
                const roleId = extractIdFromMention(role.role);
                if (!roleId) {
                    console.log(`Invalid role format: ${role.role}`);
                    return; // skip this role
                }

                permOverwrites.push(
                    { id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                );
            });

            // create the channel with all perms
            const channel = await guild.channels.create({
                name: channelName,
                type: 0, // text channel
                parent: CATEGORY, // category
                permissionOverwrites: permOverwrites,
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

        } catch (error) {
            console.log(error);
            await interaction.reply({
                content: 'Could not create ticket!',
                ephemeral: true
            });
            return;
        }
    }
    
    /* CLOSING A TICKET */
    if (interaction.isButton() && interaction.customId === 'close_ticket') {

        // build a confirmation message with buttons
        const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_close_ticket')
                .setLabel('Confirm Close')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_close_ticket')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: '⚠️ Are you sure you want to close this ticket?',
            components: [confirmRow],
            ephemeral: true,
        });
    }
    if (interaction.isButton() && interaction.customId === 'confirm_close_ticket') {
        await interaction.update({
            content: 'Closing ticket...',
            components: [],
        });
        await ticketCloseEvent(client, interaction);
    }
    if (interaction.isButton() && interaction.customId === 'cancel_close_ticket') {
        await interaction.update({
            content: 'Ticket close canceled.',
            components: [],
        });
    }
}