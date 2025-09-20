import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { lang, logger } from '../../../utils';

const announcementConfigRepo = AppDataSource.getRepository(AnnouncementConfig);

export const announcementSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const tl = lang.announcement.setup;
    const guildId = interaction.guildId || '';
    const minecraftRole = interaction.options.getRole('minecraft-role', true);
    const defaultChannel = interaction.options.getChannel('default-channel', true);

    try {
        let config = await announcementConfigRepo.findOneBy({ guildId });

        if (!config) {
            config = announcementConfigRepo.create({
                guildId,
                minecraftRoleId: minecraftRole.id,
                defaultChannelId: defaultChannel.id
            });
        } else {
            config.minecraftRoleId = minecraftRole.id;
            config.defaultChannelId = defaultChannel.id;
        }

        await announcementConfigRepo.save(config);

        await interaction.reply({
            content: tl.success + `\n• Minecraft Role: ${minecraftRole}\n• Default Channel: ${defaultChannel}`,
            ephemeral: true
        });

        logger(`User ${interaction.user.username}` + tl.configured + `${guildId}`);

    } catch (error) {
        logger(tl.error + error, 'ERROR');
        await interaction.reply({
            content: '',
            ephemeral: true
        });
    }
};