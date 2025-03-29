import { Client, ChatInputCommandInteraction, CacheType } from "discord.js";
import { AppDataSource } from "../../typeorm";
import { ServerConfig } from "../../typeorm/entities/ServerConfig";

const serverConfigRepo = AppDataSource.getRepository(ServerConfig);

export const botSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
    const serverConfig = await serverConfigRepo.findOneBy({ guildId });

    /* MODROLE SUBCOMMAND */
    if (subCommand == 'modrole') {
        // the inputted role id
        const roleId = interaction.options.getString('modrole_id') || '';
        try {
            // if we don't have a server config
            if (!serverConfig) {
                // make a new config containing the guildId and mod role id
                const newServerConfig = serverConfigRepo.create({
                    guildId,
                    modRole: roleId,
                });

                // save the new config
                await serverConfigRepo.save(newServerConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `Mod role set!`,
                    ephemeral: true,
                });
            } else {
                // update the mod role and save
                serverConfig.modRole = roleId;
                await serverConfigRepo.save(serverConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `Mod role updated!`,
                    ephemeral: true,
                });
            }
        } catch (error) {
            console.error('Failed to set mod role: ', error);
            await interaction.reply({
                content: 'Setup failed!',
                ephemeral: true,
            });
        }
    }

    /* ADMINROLE SUBCOMMAND */
    else if (subCommand == 'adminrole') {
        // the inputted role id
        const roleId = interaction.options.getString('adminrole_id') || '';
        try {
            // if we don't have a server config
            if (!serverConfig) {
                // make a new config containing the guildId and admin role id
                const newServerConfig = serverConfigRepo.create({
                    guildId,
                    adminRole: roleId,
                });

                // save the new config
                await serverConfigRepo.save(newServerConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `Admin role set!`,
                    ephemeral: true,
                });
            } else {
                // update the admin role and save
                serverConfig.adminRole = roleId;
                await serverConfigRepo.save(serverConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `Admin role updated!`,
                    ephemeral: true,
                });
            }
        } catch (error) {
            console.error('Failed to set admin role: ', error);
            await interaction.reply({
                content: 'Setup failed!',
                ephemeral: true,
            });
        }
    }
}