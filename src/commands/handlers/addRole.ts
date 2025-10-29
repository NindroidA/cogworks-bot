import { CacheType, ChatInputCommandInteraction, Client, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import { lang, logger, requireAdmin } from '../../utils';

const tl = lang.addRole;
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const addRoleHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    // Require admin permissions
    if (!await requireAdmin(interaction)) return;

    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
    const role = interaction.options.getRole('role_id')!.toString() || '';
    const alias = interaction.options.getString('alias') || '';
    const roleFinder = await savedRoleRepo.findOneBy({ role });

    // check to see if role id is already saved
    if (roleFinder) {
        await interaction.reply({
            content: tl.alreadyAdded,
            flags: [MessageFlags.Ephemeral],
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
                flags: [MessageFlags.Ephemeral],
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
                flags: [MessageFlags.Ephemeral],
            });
        }
    } catch (error) {
        logger(lang.addRole.fail + error, 'ERROR');
        await interaction.reply({
            content: tl.fail,
            flags: [MessageFlags.Ephemeral]
        });
    }
};