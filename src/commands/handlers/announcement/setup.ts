import { CacheType, ChatInputCommandInteraction, Client, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { createRateLimitKey, lang, LANGF, logger, rateLimiter, RateLimits, requireAdmin } from '../../../utils';

const announcementConfigRepo = AppDataSource.getRepository(AnnouncementConfig);

export const announcementSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    // Require admin permissions
    if (!await requireAdmin(interaction)) return;

    const tl = lang.announcement.setup;
    const guildId = interaction.guildId || '';
    
    // Rate limit check (guild-scoped: 5 setup operations per hour)
    const rateLimitKey = createRateLimitKey.guild(guildId, 'announcement-setup');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);
    
    if (!rateCheck.allowed) {
        await interaction.reply({
            content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
            flags: [MessageFlags.Ephemeral]
        });
        logger(`Rate limit exceeded for announcement setup in guild ${guildId}`, 'WARN');
        return;
    }
    
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
            flags: [MessageFlags.Ephemeral]
        });

        logger(`User ${interaction.user.username}` + tl.configured + `${guildId}`);

    } catch (error) {
        logger(tl.error + error, 'ERROR');
        await interaction.reply({
            content: '',
            flags: [MessageFlags.Ephemeral]
        });
    }
};