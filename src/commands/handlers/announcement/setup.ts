import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import {
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';

const announcementConfigRepo = AppDataSource.getRepository(AnnouncementConfig);

export const announcementSetupHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  // Require admin permissions
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const tl = lang.announcement.setup;
  const guildId = interaction.guildId || '';

  // Rate limit check (guild-scoped: 5 setup operations per hour)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'announcement-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.rateLimit(
      'Announcement setup rate limit exceeded',
      interaction.user.id,
      guildId,
    );
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
        defaultChannelId: defaultChannel.id,
      });
    } else {
      config.minecraftRoleId = minecraftRole.id;
      config.defaultChannelId = defaultChannel.id;
    }

    await announcementConfigRepo.save(config);

    await interaction.reply({
      content: `${tl.success}\n• Minecraft Role: ${minecraftRole}\n• Default Channel: ${defaultChannel}`,
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command('Announcement configured', interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error(
      'Announcement setup failed',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: '',
      flags: [MessageFlags.Ephemeral],
    });
  }
};
