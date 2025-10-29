import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GuildMember, Interaction, ModalBuilder, TextChannel, MessageFlags } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { SavedRole } from '../typeorm/entities/SavedRole';
import { Ticket } from '../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../typeorm/entities/ticket/TicketConfig';
import { createPrivateChannelPermissions, createRateLimitKey, extractIdFromMention, lang, logger, PermissionSets, rateLimiter, RateLimits } from '../utils';
import { ticketOptions } from './ticket';
import { ticketAdminOnlyEvent } from './ticket/adminOnly';
import { ageVerifyMessage, ageVerifyModal } from './ticket/ageVerify';
import { banAppealMessage, banAppealModal } from './ticket/banAppeal';
import { bugReportMessage, bugReportModal } from './ticket/bugReport';
import { ticketCloseEvent } from './ticket/close';
import { otherMessage, otherModal } from './ticket/other';
import { playerReportMessage, playerReportModal } from './ticket/playerReport';

const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
const ticketRepo = AppDataSource.getRepository(Ticket);
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const handleTicketInteraction = async(client: Client, interaction: Interaction) => {

    const user = interaction.user.username;
    const guildId = interaction.guildId || '';
    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });

    /* Create Ticket Button */
    if (interaction.isButton() && interaction.customId === 'create_ticket'){
        logger(`User ${user} ` + lang.console.createTicketAttempt);

        // check if the ticket config exists
        if (!ticketConfig) {
            logger(lang.ticket.ticketConfigNotFound);
            return;
        }

        // check if we have the right messageid
        if (ticketConfig.messageId === interaction.message.id) {
            const options = ticketOptions();
            await interaction.reply({
                content: lang.ticket.selectTicketType,
                components: [options],
                flags: [MessageFlags.Ephemeral],
            });
        }
    }

    /* Cancel Ticket Button */
    if (interaction.isButton() && interaction.customId === 'cancel_ticket') {
        logger(`User ${user} ` + lang.console.cancelTicketRequest);

        await interaction.reply({
            content: lang.ticket.cancelled,
            flags: [MessageFlags.Ephemeral]
        });
    }

    /* Ticket Option Buttons */
    if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
        const ticketType = interaction.customId.replace('ticket_', '');
        
        // Only handle valid ticket types (ignore bot setup buttons like ticket_skip, ticket_enable)
        const validTicketTypes = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];
        if (!validTicketTypes.includes(ticketType)) {
            return; // Not a ticket creation button, ignore it
        }

        logger(`User ${user} is creating a ${ticketType} ticket.`);

        // build a modal for user input
        let modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${ticketType}`)
            .setTitle(`Create ${ticketType.replace('_', ' ')} Ticket`);

        // add inputs to modal based on ticketType
        switch (ticketType) {
            case '18_verify':
                modal = await ageVerifyModal(modal);
                break;
            case 'ban_appeal':
                modal = await banAppealModal(modal);
                break;
            case 'player_report':
                modal = await playerReportModal(modal);
                break;
            case 'bug_report':
                modal = await bugReportModal(modal);
                break;
            case 'other':
                modal = await otherModal(modal);
                break;
        }

        await interaction.showModal(modal);
    }

    // handle ticket modal submission
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
        const ticketType = interaction.customId.replace('ticket_modal_', '');
        const member = interaction.member as GuildMember;
        const guild = interaction.guild;
        const category = ticketConfig?.categoryId;

        logger(`User ${user} ` + lang.console.modalSubmit);

        if (!guild) {
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        if (!category) {
            await interaction.reply({
                content: lang.ticket.ticketCategoryNotFound,
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        // Check rate limit (3 tickets per hour per user)
        const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'ticket-create');
        const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.TICKET_CREATE);
        
        if (!rateCheck.allowed) {
            await interaction.reply({
                content: rateCheck.message,
                flags: [MessageFlags.Ephemeral]
            });
            logger(`User ${user} hit ticket creation rate limit`, 'WARN');
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
                    description = await playerReportMessage(fields, interaction);
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
                guildId: guildId,
                createdBy: interaction.user.id,
                type: ticketType,
            });
            const savedTicket = await ticketRepo.save(newTicket);

            // create the ticket channel
            const channelName = `${savedTicket.id}-${ticketType}-${member.user.username}`;

            // get the staff/admin roles from the database
            const rolePerms = await savedRoleRepo.createQueryBuilder()
                .select(['type', 'role'])
                .where('guildId = :guildId', { guildId: guildId })
                .getRawMany();

            // Extract role IDs from mentions
            const staffRoleIds = rolePerms
                .map(role => extractIdFromMention(role.role))
                .filter((id): id is string => {
                    if (!id) {
                        logger(`Invalid role format: ${id}`);
                        return false;
                    }
                    return true;
                });

            // Use utility function to create permissions
            const permOverwrites = createPrivateChannelPermissions(
                guildId,
                [member.id],
                staffRoleIds,
                PermissionSets.TICKET_CREATOR
            );

            // create the channel with all perms
            const channel = await guild.channels.create({
                name: channelName,
                type: 0, // text channel
                parent: category, // category
                permissionOverwrites: permOverwrites,
            });

            await interaction.reply({
                content: lang.ticket.created + `${channel}`,
                flags: [MessageFlags.Ephemeral],
            });

            // send ticket welcome message
            const welcomeMsg = `Welcome, ${member.user.displayName}! ` + lang.ticket.welcomeMsg;
            const buttonOptions = new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                .setCustomId('admin_only_ticket')
                .setLabel('Admin Only')
                .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
            );
            const descriptionMsg = `${description}`;
            const newChannel = channel as TextChannel;

            const welc = await newChannel.send({
                content: welcomeMsg,
                components: [buttonOptions],
            });
            await newChannel.send(descriptionMsg);

            ticketRepo.update({ id: savedTicket.id }, {
                messageId: welc.id,
                channelId: newChannel.id,
                status: 'opened',
            });

            logger(`User ${user} ` + lang.console.creatTicketSuccess);

        } catch (error) {
            logger(lang.ticket.error + ' ' + error);
            await interaction.reply({
                content: lang.ticket.error,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }
    }

    /* MAKING A TICKET ADMIN ONLY */
    if (interaction.isButton() && interaction.customId === 'admin_only_ticket') {
        logger(`User ${user} ` + lang.console.adminOnlyAttempt);

        // build a confirmation message with buttons
        const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_admin_only_ticket')
                .setLabel('Confirm')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_admin_only_ticket')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: lang.ticket.adminOnly.confirm,
            components: [confirmRow],
            flags: [MessageFlags.Ephemeral],
        });
    }
    if (interaction.isButton() && interaction.customId === 'confirm_admin_only_ticket') {
        logger(`User ${user} ` + lang.console.adminOnlyConfirm);
        await interaction.update({
            content: lang.ticket.adminOnly.changing,
            components: [],
        });
        await ticketAdminOnlyEvent(client, interaction);
    }
    if (interaction.isButton() && interaction.customId === 'cancel_admin_only_ticket') {
        logger(`User ${user} ` + lang.console.adminOnlyCancel);
        await interaction.update({
            content: lang.ticket.adminOnly.cancel,
            components: [],
        });
    }
    
    /* CLOSING A TICKET */
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        logger(`User ${user} ` + lang.console.closeTicketAttempt);

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
            content: lang.ticket.close.confirm,
            components: [confirmRow],
            flags: [MessageFlags.Ephemeral],
        });
    }
    if (interaction.isButton() && interaction.customId === 'confirm_close_ticket') {
        logger(`User ${user} ` + lang.console.closeTicketConfirm);
        await interaction.update({
            content: lang.ticket.close.closing,
            components: [],
        });
        await ticketCloseEvent(client, interaction);
    }
    if (interaction.isButton() && interaction.customId === 'cancel_close_ticket') {
        logger(`User ${user} ` + lang.console.closeTicketCancel);
        await interaction.update({
            content: lang.ticket.close.cancel,
            components: [],
        });
    }
    
    /* BOTSETUP SHTUFF */
    /* Select 1 Yes */
    if (interaction.isButton() && interaction.customId === 'botsetup_s1_yes') {
        console.log();
    }

    /* Select 1 No */
    if (interaction.isButton() && interaction.customId === 'botsetup_s1_no') {
        console.log();
    }
};