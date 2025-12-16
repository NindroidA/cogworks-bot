import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GuildMember, Interaction, MessageFlags, ModalBuilder, TextChannel, TextInputBuilder, TextInputStyle } from 'discord.js';
import { emailImportModalHandler } from '../commands/handlers/ticket/emailImport';
import { typeAddModalHandler } from '../commands/handlers/ticket/typeAdd';
import { typeEditModalHandler } from '../commands/handlers/ticket/typeEdit';
import { AppDataSource } from '../typeorm';
import { SavedRole } from '../typeorm/entities/SavedRole';
import { CustomTicketType } from '../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../typeorm/entities/ticket/TicketConfig';
import { UserTicketRestriction } from '../typeorm/entities/ticket/UserTicketRestriction';
import { createPrivateChannelPermissions, createRateLimitKey, extractIdFromMention, lang, logger, PermissionSets, rateLimiter, RateLimits } from '../utils';
import { customTicketOptions, ticketOptions } from './ticket';
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

    /* Handle Custom Ticket Type Modals */
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'ticket-type-add-modal') {
            await typeAddModalHandler(interaction);
            return;
        }
        
        if (interaction.customId.startsWith('ticket-type-edit-modal:')) {
            const typeId = interaction.customId.replace('ticket-type-edit-modal:', '');
            await typeEditModalHandler(interaction, typeId);
            return;
        }
        
        if (interaction.customId === 'ticket-email-import-modal') {
            await emailImportModalHandler(interaction);
            return;
        }
    }

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
            try {
                // Try to get custom ticket types (filtered by user restrictions)
                const customOptions = await customTicketOptions(guildId, interaction.user.id);
                await interaction.reply({
                    content: lang.ticket.selectTicketType,
                    components: [customOptions],
                    flags: [MessageFlags.Ephemeral],
                });
            } catch (error) {
                // Fallback to legacy buttons if custom types fail
                console.error('Failed to load custom ticket types, using legacy options:', error);
                const options = ticketOptions();
                await interaction.reply({
                    content: lang.ticket.selectTicketType,
                    components: [options],
                    flags: [MessageFlags.Ephemeral],
                });
            }
        }
    }

    /* Cancel Ticket Button */
    if (interaction.isButton() && interaction.customId === 'cancel_ticket') {
        logger(`User ${user} ` + lang.console.cancelTicketRequest);

        // Update the message to remove components and show cancellation
        await interaction.update({
            content: lang.ticket.cancelled,
            components: []
        });
    }

    /* Custom Ticket Type Select Menu */
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_type_select') {
        const selectedTypeId = interaction.values[0];
        logger(`User ${user} selected ticket type: ${selectedTypeId}`);

        // Handle "none" option (user has no available ticket types)
        if (selectedTypeId === 'none') {
            await interaction.reply({
                content: '🚫 You do not have access to create any ticket types.',
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Check if user is restricted from creating this ticket type
        const restrictionRepo = AppDataSource.getRepository(UserTicketRestriction);
        const restriction = await restrictionRepo.findOne({
            where: { guildId, userId: interaction.user.id, typeId: selectedTypeId }
        });

        if (restriction) {
            await interaction.reply({
                content: '🚫 You are not allowed to create this type of ticket.',
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Check if this is a LEGACY ticket type that should use hardcoded modals
        const legacyTypes = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];
        if (legacyTypes.includes(selectedTypeId)) {
            logger(`User ${user} is creating a ${selectedTypeId} ticket (using legacy modal).`);

            // Use legacy modal builders for legacy types
            let modal = new ModalBuilder()
                .setCustomId(`ticket_modal_${selectedTypeId}`)
                .setTitle(`Create ${selectedTypeId.replace('_', ' ')} Ticket`);

            // Add inputs to modal based on ticketType
            switch (selectedTypeId) {
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

            // Show the modal (this is the ONLY response we can give)
            await interaction.showModal(modal);
            
            return;
        }

        // Get the custom ticket type details
        const typeRepo = AppDataSource.getRepository(CustomTicketType);
        const ticketType = await typeRepo.findOne({
            where: { guildId, typeId: selectedTypeId }
        });

        if (!ticketType) {
            await interaction.reply({
                content: '❌ Selected ticket type not found!',
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Build modal with custom fields or default description
        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_${ticketType.typeId}`)
            .setTitle(`${ticketType.emoji || '🎫'} ${ticketType.displayName}`);

        // Check if custom fields are configured
        if (ticketType.customFields && ticketType.customFields.length > 0) {
            // Use custom fields (max 5 fields per modal in Discord)
            const fieldsToAdd = ticketType.customFields.slice(0, 5);
            
            for (const field of fieldsToAdd) {
                const input = new TextInputBuilder()
                    .setCustomId(field.id)
                    .setLabel(field.label)
                    .setStyle(field.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
                    .setRequired(field.required);

                if (field.placeholder) input.setPlaceholder(field.placeholder);
                if (field.minLength) input.setMinLength(field.minLength);
                if (field.maxLength) input.setMaxLength(field.maxLength);

                const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
                modal.addComponents(actionRow);
            }
        } else {
            // No custom fields - use default description field
            const descriptionInput = new TextInputBuilder()
                .setCustomId('ticket_description')
                .setLabel('Please describe your issue')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(ticketType.description || 'Provide details about your ticket...')
                .setRequired(true)
                .setMaxLength(2000);

            const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);
            modal.addComponents(actionRow);
        }

        // Show the modal (this consumes the interaction)
        await interaction.showModal(modal);
        
        // Delete the ephemeral message after a short delay
        // We need to wait a bit for the modal to fully open
        setTimeout(async () => {
            try {
                // Delete the original ephemeral message
                await interaction.message.delete();
            } catch {
                // Silently fail - message might already be gone
            }
        }, 500);
        
        return;
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

            // Check if this is a LEGACY ticket type
            const legacyTypes = ['18_verify', 'ban_appeal', 'player_report', 'bug_report', 'other'];
            const isLegacyType = legacyTypes.includes(ticketType);

            if (isLegacyType) {
                // Use legacy message builders for legacy types
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
            } else {
                // Get the ticket type from database for custom types
                const typeRepo = AppDataSource.getRepository(CustomTicketType);
                const ticketTypeConfig = await typeRepo.findOne({
                    where: { guildId, typeId: ticketType }
                });

                if (!ticketTypeConfig) {
                    await interaction.reply({
                        content: '❌ Ticket type configuration not found!',
                        flags: [MessageFlags.Ephemeral]
                    });
                    return;
                }

                // Build description from custom fields or default field
                // Add header with ticket type name
                const header = `# ${ticketTypeConfig.displayName}\n`;
                
                if (ticketTypeConfig.customFields && ticketTypeConfig.customFields.length > 0) {
                    // Build formatted description from all custom field responses
                    const fieldResponses: string[] = [];
                    
                    for (const field of ticketTypeConfig.customFields) {
                        try {
                            const value = fields.getTextInputValue(field.id);
                            fieldResponses.push(`**${field.label}:** ${value}`);
                        } catch {
                            // Field not found in response (optional field)
                            continue;
                        }
                    }
                    
                    description = header + fieldResponses.join('\n');
                } else {
                    // No custom fields - use default description field
                    const defaultValue = fields.getTextInputValue('ticket_description');
                    description = header + defaultValue;
                }
            }

            // Get ticket type details for channel naming
            let emoji = '🎫';
            let displayName = ticketType;
            
            if (isLegacyType) {
                // Use legacy emoji/names
                const legacyInfo: Record<string, { emoji: string; name: string }> = {
                    '18_verify': { emoji: '🔞', name: '18+ Verify' },
                    'ban_appeal': { emoji: '⚖️', name: 'Ban Appeal' },
                    'player_report': { emoji: '📢', name: 'Player Report' },
                    'bug_report': { emoji: '🐛', name: 'Bug Report' },
                    'other': { emoji: '❓', name: 'Other' }
                };
                emoji = legacyInfo[ticketType]?.emoji || '🎫';
                displayName = legacyInfo[ticketType]?.name || ticketType;
            } else {
                // Get from database for custom types
                const typeRepo = AppDataSource.getRepository(CustomTicketType);
                const ticketTypeConfig = await typeRepo.findOne({
                    where: { guildId, typeId: ticketType }
                });
                
                if (ticketTypeConfig) {
                    emoji = ticketTypeConfig.emoji || '🎫';
                    displayName = ticketTypeConfig.displayName || ticketType;
                }
            }

            // create new ticket in the database
            const ticketData: Partial<Ticket> = {
                guildId: guildId,
                createdBy: interaction.user.id,
                type: ticketType,
            };
            
            if (!isLegacyType) {
                ticketData.customTypeId = ticketType;
            }
            
            const newTicket = ticketRepo.create(ticketData);
            const savedTicket = await ticketRepo.save(newTicket) as Ticket;

            // create the ticket channel with numbering
            const channelName = `${savedTicket.id}-${emoji}-${displayName}-${member.user.username}`.substring(0, 100);

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

            // send ticket welcome message with @ mention
            const welcomeMsg = `<@${member.user.id}>\n\n` + lang.ticket.welcomeMsg;
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