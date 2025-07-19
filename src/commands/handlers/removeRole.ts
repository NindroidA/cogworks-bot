import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import { lang, logger } from '../../utils';

const tl = lang.removeRole;
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const removeRoleHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
    const role = interaction.options.getRole('role_id')!.toString() || '';
    const roleFinder = await savedRoleRepo.findOneBy({ role });
    const guildFinder = await savedRoleRepo.findOneBy({ guildId });

    // check to see if the discord server has any saved roles
    if (!guildFinder) {
        await interaction.reply({
            content: tl.noType,
            ephemeral: true,
        });
        return;
    }

    // check to see if the role exists
    if (!roleFinder) {
        await interaction.reply({
            content: tl.dne,
            ephemeral: true,
        });
        return;
    }

    try {
        if (subCommand == 'staff') {
            const typeFinder = await savedRoleRepo.findOneBy({ type:'staff' });

            if (!typeFinder) {
                await interaction.reply({
                    content: tl.noType,
                    ephemeral: true,
                });
                return;
            }

            savedRoleRepo.createQueryBuilder()
                .delete()
                .where('role = :role', { role: role })
                .andWhere('type = :type', { type: 'staff' })
                .execute();

            // after completion, send an ephemeral success message
            await interaction.reply({
                content: tl.successStaff,
                ephemeral: true,
            });

        } else if (subCommand == 'admin') {
            const typeFinder = await savedRoleRepo.findOneBy({ type:'admin' });

            if (!typeFinder) {
                await interaction.reply({
                    content: tl.noType,
                    ephemeral: true,
                });
                return;
            }

            savedRoleRepo.createQueryBuilder()
                .delete()
                .where('role = :role', { role: role })
                .andWhere('type = :type', { type: 'admin' })
                .execute();
            
            // after completion, send an ephemeral success message
            await interaction.reply({
                content: tl.successAdmin,
                ephemeral: true,
            });

        }

    } catch (error) {
        logger(tl.fail + error, 'ERROR');
        await interaction.reply({
            content: tl.fail,
            ephemeral: true
        });
    }
};