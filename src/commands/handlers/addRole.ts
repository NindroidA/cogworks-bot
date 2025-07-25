import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import { lang, logger } from '../../utils';

const tl = lang.addRole;
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const addRoleHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
    const role = interaction.options.getRole('role_id')!.toString() || '';
    const alias = interaction.options.getString('alias') || '';
    const roleFinder = await savedRoleRepo.findOneBy({ role });

    // check to see if role id is already saved
    if (roleFinder) {
        await interaction.reply({
            content: tl.alreadyAdded,
            ephemeral: true,
        });
        return;
    }

    try {
        if (subCommand == 'staff') {
            const values = [{ guildId: guildId, type: 'staff', role: role, alias: alias }];

            // insert a new entry to the table
            savedRoleRepo.createQueryBuilder()
                .insert()
                .values(values)
                .execute();

            // after completion, send an ephemeral success message
            await interaction.reply({
                content: tl.successStaff,
                ephemeral: true,
            });

        } else if (subCommand == 'admin') {
            const values = [{ guildId: guildId, type: 'admin', role: role, alias: alias }];

            // insert a new entry to the table
            savedRoleRepo.createQueryBuilder()
                .insert()
                .values(values)
                .execute();

            // after completion, send an ephemeral success message
            await interaction.reply({
                content: tl.successAdmin,
                ephemeral: true,
            });
        }
    } catch (error) {
        logger(lang.addRole.fail + error, 'ERROR');
        await interaction.reply({
            content: tl.fail,
            ephemeral: true
        });
    }
};