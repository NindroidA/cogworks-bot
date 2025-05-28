import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import lang from '../../utils/lang.json';

const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const getRolesHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const guildId = interaction.guildId || '';
    const guildFinder = await savedRoleRepo.findOneBy({ guildId });

    // check to see if the discord server has any saved roles
    if (!guildFinder) {
        await interaction.reply({
            content: lang.getRoles.noGuild,
            ephemeral: true,
        });
        return;
    }

    try {
        // message that'll be formatted
        let message = '';

        // select the saved roles for the guild
        const foundRoles = await savedRoleRepo.createQueryBuilder()
        .select('type')
        .addSelect('role')
        .addSelect('alias')
        .where('guildId = :guildId', { guildId: guildId })
        .getRawMany();

        // group roles by type
        const roleGroups: Record<string, {alias: string, role: string}[]> = {};
        foundRoles.forEach(role => {
            if (!roleGroups[role.type]) {
                roleGroups[role.type] = [];
            }
            roleGroups[role.type].push({
                alias: role.alias,
                role: role.role
            });
        });

        // format staff roles
        if (roleGroups['staff']) {
            message += '**Staff Roles:**\n';
            roleGroups['staff'].forEach(r => {
                message += `* ${r.alias} - ${r.role}\n`;
            });
            message += '\n';
        }

        // format admin roles
        if (roleGroups['admin']) {
            message += '**Admin Roles:**\n';
            roleGroups['admin'].forEach(r => {
                message += `* ${r.alias} - ${r.role}\n`;
            });
            message += '\n';
        }

        // if no roles found
        if (message === '') {
            message = lang.getRoles.noGuild;
        }

        await interaction.reply({
            content: message,
            ephemeral: true
        });

    } catch (error) {
        console.log(lang.getRoles.fail, error);
        await interaction.reply({
            content: lang.getRoles.fail,
            ephemeral: true
        });
    }

};