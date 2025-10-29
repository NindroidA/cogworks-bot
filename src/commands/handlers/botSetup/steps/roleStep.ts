/**
 * Role Management Step - Bot Setup Wizard
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder } from 'discord.js';

export const roleStep = {
    buildEmbed: () => {
        return new EmbedBuilder()
            .setTitle('👥 Role Management Setup')
            .setDescription(
                '**Would you like to configure staff and admin roles?**\n\n' +
                'This allows you to save roles that can be used for permissions.\n\n' +
                '**This includes:**\n' +
                '• Staff roles (can manage tickets/applications)\n' +
                '• Admin roles (full bot permissions)\n\n' +
                '**You can skip this and add roles later with `/add-role`**'
            )
            .setColor('#FEE75C');
    },

    buildComponents: () => {
        return [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('role_enable')
                    .setLabel('Configure Roles')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👥'),
                new ButtonBuilder()
                    .setCustomId('role_skip')
                    .setLabel('Skip')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('setup_cancel')
                    .setLabel('Cancel Setup')
                    .setStyle(ButtonStyle.Danger)
            )
        ];
    },

    buildRoleTypeEmbed: () => {
        return new EmbedBuilder()
            .setTitle('👥 Add Role')
            .setDescription(
                'What type of role would you like to add?\n\n' +
                '**Staff Role:** Can manage tickets and applications\n' +
                '**Admin Role:** Full bot permissions\n\n' +
                'You can add multiple roles of each type.'
            )
            .setColor('#FEE75C');
    },

    buildRoleTypeSelect: () => {
        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('role_type_select')
                .setPlaceholder('Select role type')
                .addOptions([
                    {
                        label: 'Staff Role',
                        value: 'staff',
                        description: 'Can manage tickets and applications',
                        emoji: '👔'
                    },
                    {
                        label: 'Admin Role',
                        value: 'admin',
                        description: 'Full bot permissions',
                        emoji: '⭐'
                    }
                ])
        );
    },

    buildRoleSelectEmbed: (roleType: string) => {
        const emoji = roleType === 'staff' ? '👔' : '⭐';
        const typeName = roleType === 'staff' ? 'Staff' : 'Admin';
        
        return new EmbedBuilder()
            .setTitle(`${emoji} Select ${typeName} Role`)
            .setDescription(
                `Select the role to add as a ${typeName.toLowerCase()} role.\n\n` +
                'You can optionally provide an alias for this role.'
            )
            .setColor('#FEE75C');
    },

    buildRoleSelect: () => {
        return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('role_select_' + Date.now())
                .setPlaceholder('Select a role')
        );
    },

    buildAddMoreEmbed: (addedRoles: Array<{ type: string; role: string; alias?: string }>) => {
        let description = '**Roles added so far:**\n\n';
        
        const staffRoles = addedRoles.filter(r => r.type === 'staff');
        const adminRoles = addedRoles.filter(r => r.type === 'admin');

        if (staffRoles.length > 0) {
            description += '**👔 Staff Roles:**\n';
            staffRoles.forEach(r => {
                description += `• ${r.role}${r.alias ? ` (${r.alias})` : ''}\n`;
            });
            description += '\n';
        }

        if (adminRoles.length > 0) {
            description += '**⭐ Admin Roles:**\n';
            adminRoles.forEach(r => {
                description += `• ${r.role}${r.alias ? ` (${r.alias})` : ''}\n`;
            });
            description += '\n';
        }

        description += 'Would you like to add more roles?';

        return new EmbedBuilder()
            .setTitle('👥 Role Management')
            .setDescription(description)
            .setColor('#FEE75C');
    },

    buildAddMoreButtons: () => {
        return [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('role_add_more')
                    .setLabel('Add Another Role')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('➕'),
                new ButtonBuilder()
                    .setCustomId('role_done')
                    .setLabel('Continue')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('setup_cancel')
                    .setLabel('Cancel Setup')
                    .setStyle(ButtonStyle.Danger)
            )
        ];
    }
};
