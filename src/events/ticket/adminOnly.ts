import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Client, TextChannel } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import { Ticket } from '../../typeorm/entities/Ticket';
import { extractIdFromMention } from '../../utils/extractIdFromMention';
import lang from '../../utils/lang.json';

const ticketRepo = AppDataSource.getRepository(Ticket);
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const ticketAdminOnlyEvent = async(client: Client, interaction: ButtonInteraction) => {
    const channel = interaction.channel as TextChannel;
    const channelId = interaction.channelId;
    const guild = interaction.guild;
    const user = interaction.user.displayName;
    const userId = interaction.user.id;
    const ticket = await ticketRepo.findOneBy({ channelId: channelId });

    if (!guild) { 
        await interaction.reply({
            content: lang.general.cmdGuildNotFound,
            ephemeral: true,
        });
        return;
    }

    // check if the ticket exists in the database
    if (!ticket) { return console.log(lang.general.fatalError); }

    // check if the person hitting the button is the ticket creator
    if (userId == ticket.createdBy) {
        // send a request message (for a staff member to do it for them)
        await channel.send({
            content: `❗Oh, Mods!❗ ${user} ` + lang.ticket.adminOnly.request
        });
        return;
    }

    const savedRoles = await savedRoleRepo.createQueryBuilder()
        .select(['role'])
        .where('guildId = :guildId', { guildId: guild.id })
        .andWhere('type = :type', { type: 'staff' })
        .getRawMany();


    // get each staff role and remove them from being able to view the channel
    savedRoles.forEach(role => {
        const roleId = extractIdFromMention(role.role);
        if (!roleId) {
            console.log(`Invalid role format: ${role.role}`);
            return; // skip this role
        }

        channel.permissionOverwrites.edit(roleId, { 
            'ViewChannel': false 
        });
    });

    // edit the channel's initial welcome message to not include the admin only button
    const messageId = ticket.messageId;
    const msg = channel.messages.fetch(messageId);

    // close ticket button
    const closeButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
        new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
    );

    // set the components of the welcome message to just have the close button
    (await msg)?.edit({ components: [closeButton] });

    // update the ticket status
    await ticketRepo.update({ id: ticket.id }, { status: 'adminOnly' });
    
};