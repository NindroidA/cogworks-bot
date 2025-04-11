import { Client, ChatInputCommandInteraction, CacheType } from "discord.js";
import { AppDataSource } from "../../typeorm";
import { SavedRole } from "../../typeorm/entities/SavedRole";
import lang from "../../utils/lang.json";

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
            content: lang.removeRole.noType,
            ephemeral: true,
        });
        return;
    }

    // check to see if the role exists
    if (!roleFinder) {
        await interaction.reply({
            content: lang.removeRole.dne,
            ephemeral: true,
        });
        return;
    }

    try {
        if (subCommand == 'staff') {
            const typeFinder = await savedRoleRepo.findOneBy({ type:'staff' });

            if (!typeFinder) {
                await interaction.reply({
                    content: lang.removeRole.noType,
                    ephemeral: true,
                });
                return;
            }

            savedRoleRepo.createQueryBuilder()
                .delete()
                .where("role = :role", { role: role })
                .andWhere("type = :type", { type: 'staff' })
                .execute();

            // after completion, send an ephemeral success message
            await interaction.reply({
                content: lang.removeRole.successStaff,
                ephemeral: true,
            });

        } else if (subCommand == 'admin') {
            const typeFinder = await savedRoleRepo.findOneBy({ type:'admin' });

            if (!typeFinder) {
                await interaction.reply({
                    content: lang.removeRole.noType,
                    ephemeral: true,
                });
                return;
            }

            savedRoleRepo.createQueryBuilder()
                .delete()
                .where("role = :role", { role: role })
                .andWhere("type = :type", { type: 'admin' })
                .execute();
            
            // after completion, send an ephemeral success message
            await interaction.reply({
                content: lang.removeRole.successAdmin,
                ephemeral: true,
            });

        }

    } catch (error) {
        console.log(lang.removeRole.fail, error);
        await interaction.reply({
            content: lang.removeRole.fail,
            ephemeral: true
        });
    }
}