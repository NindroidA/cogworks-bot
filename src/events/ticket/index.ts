import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { UserTicketRestriction } from '../../typeorm/entities/ticket/UserTicketRestriction';

/* Legacy options for how the user would like to open a ticket (fallback) */
export const ticketOptions = () => {
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
    );

    return options;
};

/* Dynamic ticket type options based on custom ticket types */
export const customTicketOptions = async (guildId: string, userId?: string): Promise<ActionRowBuilder<StringSelectMenuBuilder>> => {
    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    // Get all active ticket types for the guild
    let types = await typeRepo.find({
        where: { guildId, isActive: true },
        order: { sortOrder: 'ASC' }
    });

    // Filter out restricted types if userId is provided
    if (userId) {
        const restrictionRepo = AppDataSource.getRepository(UserTicketRestriction);
        const restrictions = await restrictionRepo.find({
            where: { guildId, userId }
        });
        const restrictedTypeIds = new Set(restrictions.map(r => r.typeId));
        types = types.filter(type => !restrictedTypeIds.has(type.typeId));
    }

    // Build select menu options from custom types only
    const options = types.map(type =>
        new StringSelectMenuOptionBuilder()
            .setLabel(type.displayName)
            .setValue(type.typeId)
            .setDescription(type.description?.substring(0, 100) || 'Select this ticket type')
            .setEmoji(type.emoji || '🎫')
    );

    // If no options available (all restricted), add a placeholder
    if (options.length === 0) {
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel('No ticket types available')
                .setValue('none')
                .setDescription('You do not have access to create any ticket types')
                .setEmoji('🚫')
        );
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_type_select')
        .setPlaceholder('Select a ticket type...')
        .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
};
